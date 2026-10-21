import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BlizzardBudget } from '../src/common/quota/budgets.js';
import { CacheService } from '../src/redis/cache.service.js';
import type { RecordedRequest } from './support/fake-upstream.js';
import {
  anonymousTokens,
  bootTestApp,
  resetRedis,
  type Json,
  type TestApp,
} from './support/app.js';
import { openTestDatabase } from './support/database.js';

let app: TestApp;
let db: Db;
let drop: () => Promise<void>;
let token: string;

const CHARACTER = '/blizzard/us/profile/wow/character/demon-soul/manongauz';
const CORE_KEY = 'pvp:character:us:demon-soul:manongauz:core';
const BRACKETS = ['3v3', 'shuffle-paladin-holy'];
/** 4 core calls + one per bracket + 3 per language. */
const FULL_LOOKUP = 4 + BRACKETS.length + 3;

const ref = (id: number, name: string) => ({ id, name });

/** Blizzard's answers for one character, by the path after the character. */
const PAYLOADS: Record<string, unknown> = {
  '': {
    id: 203724421,
    name: 'Manongauz',
    level: 90,
    race: ref(1, 'Human'),
    character_class: ref(2, 'Paladin'),
    active_spec: ref(65, 'Holy'),
    faction: { type: 'ALLIANCE', name: 'Alliance' },
    gender: { type: 'FEMALE', name: 'Female' },
    realm: { id: 1286, name: 'Demon Soul', slug: 'demon-soul' },
  },
  '/character-media': {
    assets: [{ key: 'main-raw', value: 'https://render/203724421-main-raw.png' }],
  },
  '/pvp-summary': {
    brackets: BRACKETS.map((bracket) => ({
      href: `https://us.api.blizzard.com${CHARACTER}/pvp-bracket/${bracket}?namespace=profile-us`,
    })),
    honor_level: 1991,
  },
  '/pvp-bracket/3v3': {
    bracket: { id: 1, type: 'ARENA_3v3' },
    rating: 2100,
    season: { id: 42 },
    season_match_statistics: { played: 10, won: 6, lost: 4 },
  },
  '/pvp-bracket/shuffle-paladin-holy': {
    bracket: { id: 6, type: 'SHUFFLE' },
    rating: 2729,
    season: { id: 42 },
    season_match_statistics: { played: 29, won: 28, lost: 1 },
    specialization: ref(65, 'Holy'),
  },
  '/statistics': { mastery: { value: 64.9, rating_normalized: 1208 } },
  '/specializations': {
    active_specialization: ref(65, 'Holy'),
    specializations: [
      {
        specialization: ref(65, 'Holy'),
        loadouts: [{ is_active: true, talent_loadout_code: 'CODE' }],
      },
    ],
  },
  '/equipment': { equipped_items: [{ item: { id: 1 }, slot: { type: 'HEAD', name: 'Head' } }] },
  '/achievements': {
    achievements: [
      {
        id: 62929,
        achievement: ref(62929, 'Duelist: Midnight Season 2'),
        criteria: { is_completed: true },
        completed_timestamp: Date.parse('2026-08-20T10:00:00Z'),
      },
      {
        id: 61179,
        achievement: ref(61179, 'Galactic Legend: Midnight Season 1'),
        criteria: { is_completed: false },
        completed_timestamp: Date.parse('2026-08-25T10:00:00Z'),
      },
    ],
  },
};

const blizzard = () => app.upstream.requestsTo('/blizzard');
const syncs = () => app.upstream.requestsTo('/rankwarden/characters/sync');

async function lookup(query = ''): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(
    `${app.url}/pvp/character?region=us&realmSlug=demon-soul&characterName=Manongauz${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  return {
    status: response.status,
    body: (await response.json()) as Json,
    headers: response.headers,
  };
}

/** Waits for the push Rankwarden gets after the response has gone. */
async function syncPosted(count = 1): Promise<RecordedRequest[]> {
  for (let i = 0; i < 100 && syncs().length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return syncs();
}

beforeAll(async () => {
  app = await bootTestApp({
    env: {
      RATE_LIMIT_API_PER_MINUTE: '1000',
      BLIZZARD_HOURLY_LIMIT: '40',
      BLIZZARD_PER_SECOND_LIMIT: '40',
      BLIZZARD_UTILISATION: '1',
      BLIZZARD_RETRY_LIMIT: '0',
    },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('season_state').insertOne({
    region: 'us',
    seasonId: 42,
    name: 'Season 42',
    startsAt: new Date('2026-08-18T15:00:00Z'),
    endsAt: null,
  });
  await db.collection('archive_seasons').insertOne({
    region: 'us',
    seasonId: 41,
    name: 'Season 41',
    startsAt: new Date('2026-03-17T15:00:00Z'),
    endsAt: new Date('2026-08-11T15:00:00Z'),
    rewards: [
      {
        bracket: 'shuffle-paladin-holy',
        faction: null,
        ratingCutoff: 2900,
        title: 'Galactic Legend: Midnight Season 1',
        achievementId: 61179,
        specialization: ref(65, 'Holy'),
      },
    ],
  });
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

beforeEach(async () => {
  await resetRedis(app);
  app.upstream.reset();
  app.upstream.route((request) => {
    if (request.path === '/rankwarden/characters/sync') return { status: 200, body: {} };
    if (!request.path.startsWith('/blizzard')) return undefined;
    // Every endpoint of a character Blizzard does not have is a 404.
    if (!request.path.startsWith(`${CHARACTER}/`) && request.path !== CHARACTER) {
      return { status: 404, body: {} };
    }

    const body = PAYLOADS[request.path.slice(CHARACTER.length)];
    return body === undefined ? { status: 404, body: {} } : { status: 200, body };
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /pvp/character', () => {
  it('builds the page from Blizzard, then serves it from the cache', async () => {
    const first = await lookup();

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      region: 'us',
      locale: 'en_US',
      seasonId: 42,
      character: { id: 203724421, faction: 'alliance', class: { name: 'Paladin' } },
      media: { mainRaw: 'https://render/203724421-main-raw.png', avatar: null },
      honor: { level: 1991 },
      statistics: { mastery: { value: 64.9, rating: 1208 } },
      stale: false,
    });
    expect(first.body.brackets.map((b: Json) => b.bracket)).toEqual(BRACKETS);
    expect(first.body.pvpHistory).toMatchObject([
      { achievementId: 61179, tier: 'rank-one', seasonId: 41, earnedByThisCharacter: false },
      { achievementId: 62929, tier: 'duelist', seasonId: 42, earnedByThisCharacter: true },
    ]);
    expect(blizzard()).toHaveLength(FULL_LOOKUP);
    expect(blizzard().every((request) => request.query.get('locale') === 'en_US')).toBe(true);

    const second = await lookup();

    expect(second.body).toEqual(first.body);
    expect(blizzard()).toHaveLength(FULL_LOOKUP);
  });

  it('pushes every ladder to Rankwarden after responding, without a rank', async () => {
    await lookup();

    const [push] = await syncPosted();
    expect(push?.body).toMatchObject({
      seasonId: 42,
      region: 'us',
      characterId: 203724421,
      realmId: 1286,
      faction: 'ALLIANCE',
      brackets: {
        '3v3': { rating: 2100, played: 10, won: 6, lost: 4 },
        'shuffle-paladin-holy': { rating: 2729, played: 29, won: 28, lost: 1 },
      },
      profile: { class: ref(2, 'Paladin'), gender: 'FEMALE', realmName: 'Demon Soul' },
    });
    expect((push?.body as Json).brackets['3v3']).not.toHaveProperty('rank');
  });

  it('fetches only the translated part for a second language', async () => {
    await lookup();
    await syncPosted();
    app.upstream.requests.length = 0;

    const german = await lookup('&locale=de_DE');

    expect(german.body.locale).toBe('de_DE');
    expect(
      blizzard()
        .map((request) => request.path.slice(CHARACTER.length))
        .sort(),
    ).toEqual(['', '/equipment', '/specializations']);
    expect(blizzard().every((request) => request.query.get('locale') === 'de_DE')).toBe(true);
    // The ratings were not fetched again, so there is nothing new to push.
    expect(syncs()).toHaveLength(0);
  });

  it('honours forceRefresh once per cooldown', async () => {
    await lookup();
    expect(blizzard()).toHaveLength(FULL_LOOKUP);

    await lookup('&forceRefresh=true');
    expect(blizzard()).toHaveLength(2 * FULL_LOOKUP);

    await lookup('&forceRefresh=true');
    expect(blizzard()).toHaveLength(2 * FULL_LOOKUP);
  });

  it('answers 404 for a character Blizzard does not have, and caches nothing', async () => {
    const response = await fetch(
      `${app.url}/pvp/character?region=us&realmSlug=demon-soul&characterName=Nobody`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(404);
    expect(
      await app.app.get(CacheService).get('pvp:character:us:demon-soul:nobody:core'),
    ).toBeNull();
  });

  it('answers 400 listing every missing identity field', async () => {
    const response = await fetch(`${app.url}/pvp/character?region=us`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as Json;

    expect(response.status).toBe(400);
    expect(body.issues.map((issue: Json) => issue.path)).toEqual(['realmSlug', 'characterName']);
  });

  describe('with the Blizzard budget spent', () => {
    async function spendBudget(): Promise<void> {
      const budget = app.app.get(BlizzardBudget);
      for (;;) {
        try {
          await budget.acquire();
        } catch {
          return;
        }
      }
    }

    it('serves the expired page, marked stale', async () => {
      await lookup();
      const cache = app.app.get(CacheService);
      const core = (await cache.get<Json>(CORE_KEY))!;
      await cache.set(CORE_KEY, { ...core, fetchedAt: '2026-01-01T00:00:00.000Z' });

      await spendBudget();
      app.upstream.requests.length = 0;
      const response = await lookup();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ stale: true, fetchedAt: '2026-01-01T00:00:00.000Z' });
      expect(blizzard()).toHaveLength(0);
    });

    it('answers 503 with Retry-After when nothing is cached', async () => {
      await spendBudget();
      const response = await lookup();

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('60');
      expect(blizzard()).toHaveLength(0);
    });
  });
});
