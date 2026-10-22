import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RaiderIoBudget } from '../src/common/quota/budgets.js';
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

const FULL_KEY = 'pve:character:us:demon-soul:manongauz:full';

const BASE = {
  name: 'Manongauz',
  race: 'Human',
  class: 'Paladin',
  active_spec_name: 'Holy',
  active_spec_role: 'HEALING',
  gender: 'female',
  faction: 'alliance',
  region: 'us',
  realm: 'Demon Soul',
  thumbnail_url: 'https://render/avatar.jpg',
};

const RUN = {
  dungeon: 'Temple of Sethraliss',
  short_name: 'TOS',
  mythic_level: 14,
  completed_at: '2026-09-21T00:42:59.000Z',
  clear_time_ms: 1736151,
  keystone_run_id: 14738020,
  par_time_ms: 1920999,
  num_keystone_upgrades: 1,
  zone_id: 9527,
  score: 398.6,
  affixes: [
    { id: 10, name: 'Fortified', icon_url: 'https://cdn/f.jpg', wowhead_url: 'https://w/10' },
  ],
  url: 'https://raider.io/mythic-plus-runs/season-mn-2/14738020-14-temple-of-sethraliss',
  spec: { id: 65, name: 'Holy' },
  role: 'healer',
};

/** What Raider.io answers for each field Soulseeker asks for. */
function answerFor(field: string): Record<string, unknown> {
  const [name, ...args] = field.split(':');
  const season = args[0] === 'current' ? 'season-mn-2' : args[0];

  switch (name) {
    case 'gear':
      return {
        gear: {
          item_level_equipped: 291,
          items: { head: { item_id: 1, item_level: 308, name: 'Helm' } },
        },
      };
    case 'talents':
      return { talentLoadout: { loadout_spec_id: 65, loadout_text: 'CODE' } };
    case 'guild':
      return { guild: { name: 'veow', realm: 'Demon Soul' } };
    case 'raid_progression':
      return {
        raid_progression: {
          [args[0] === 'current-expansion' ? 'tier-mn-1' : args[0]!]: { total_bosses: 9 },
        },
      };
    case 'raid_achievement_curve':
      return { raid_achievement_curve: [{ raid: args[0], aotc: '2026-04-22T01:53:00.000Z' }] };
    case 'mythic_plus_scores_by_season':
      return { mythic_plus_scores_by_season: [{ season, scores: { all: 1760.9 }, segments: {} }] };
    case 'mythic_plus_ranks':
      return { mythic_plus_ranks: { overall: { world: 1 } } };
    case 'mythic_plus_best_runs':
      return { mythic_plus_best_runs: [RUN] };
    default:
      return {};
  }
}

const raiderIo = () => app.upstream.requestsTo('/raiderio');
const fieldsOf = (request: RecordedRequest | undefined) =>
  request?.query.get('fields')?.split(',').sort();
const syncs = () => app.upstream.requestsTo('/rankwarden/mplus/characters/sync');

async function lookup(query = ''): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(
    `${app.url}/pve/character?region=us&realmSlug=demon-soul&characterName=Manongauz${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  return {
    status: response.status,
    body: (await response.json()) as Json,
    headers: response.headers,
  };
}

async function syncPosted(): Promise<RecordedRequest[]> {
  for (let i = 0; i < 100 && syncs().length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return syncs();
}

beforeAll(async () => {
  app = await bootTestApp({
    env: {
      RATE_LIMIT_API_PER_MINUTE: '1000',
      RAIDERIO_MINUTE_LIMIT: '20',
      RAIDERIO_UTILISATION: '1',
      RAIDERIO_RETRY_LIMIT: '0',
      PVE_CATALOGUE_TTL_SECONDS: '1',
    },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertOne({
    id: 1,
    slug: 'tier-mn-1',
    name: 'Tier MN 1',
    expansionId: 11,
    starts: { us: new Date('2026-03-17T15:00:00Z') },
    encounters: [],
  });
  await db.collection('mplus_seasons').insertOne({
    slug: 'season-mn-2',
    name: 'MN Season 2',
    expansionId: 11,
    starts: { us: new Date('2026-08-18T15:00:00Z') },
    dungeonIds: [9527],
  });
  // The catalogue was read at boot, before these: let its 1 s TTL pass.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
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
    if (request.path === '/rankwarden/mplus/characters/sync') return { status: 200, body: {} };
    if (request.path !== '/raiderio/characters/profile') return undefined;
    // Raider.io answers 400 for a character it does not know.
    if (request.query.get('name') !== 'manongauz')
      return { status: 400, body: { message: 'not found' } };

    const fields = request.query.get('fields')?.split(',') ?? [];
    return { status: 200, body: Object.assign({ ...BASE }, ...fields.map(answerFor)) };
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /pve/character', () => {
  it('builds the whole page in one Raider.io request, then serves it from the cache', async () => {
    const first = await lookup();

    expect(first.status).toBe(200);
    expect(fieldsOf(raiderIo()[0])).toEqual([
      'gear',
      'guild',
      'mythic_plus_best_runs:all',
      'mythic_plus_ranks',
      'mythic_plus_scores_by_season:current',
      'raid_progression:current-expansion',
      'talents:categorized',
    ]);
    expect(first.body).toMatchObject({
      character: { name: 'Manongauz', activeSpecName: 'Holy', realm: 'Demon Soul' },
      guild: { name: 'veow' },
      gear: { itemLevelEquipped: 291 },
      raidProgression: { 'tier-mn-1': { total_bosses: 9 } },
      mythicPlusScores: [{ season: 'season-mn-2', scores: { all: 1760.9 } }],
      mythicPlusBestRuns: [{ dungeon: 'Temple of Sethraliss', spec: { id: 65 } }],
      stale: false,
    });
    expect(first.body.mythicPlusBestRuns[0]).not.toHaveProperty('keystone_run_id');

    const second = await lookup();
    expect(second.body).toEqual(first.body);
    expect(raiderIo()).toHaveLength(1);
  });

  it('pushes the season’s runs to Rankwarden after a fresh whole page', async () => {
    await lookup();

    const [push] = await syncPosted();
    expect(push?.body).toMatchObject({
      season: 'season-mn-2',
      region: 'us',
      realmSlug: 'demon-soul',
      characterName: 'Manongauz',
      dungeonRuns: [
        {
          dungeon: { id: 9527, slug: 'temple-of-sethraliss', shortName: 'TOS' },
          keystoneRunId: 14738020,
          specId: 65,
          role: 'healer',
        },
      ],
      profile: { className: 'Paladin', role: 'healer' },
    });
  });

  it('asks only for a raid when a widget names one, and caches it apart', async () => {
    const raid = await lookup('&raidProgression=tier-mn-1');

    expect(fieldsOf(raiderIo()[0])).toEqual([
      'raid_achievement_curve:tier-mn-1',
      'raid_progression:tier-mn-1',
    ]);
    expect(Object.keys(raid.body).sort()).toEqual([
      'character',
      'fetchedAt',
      'raidAchievementCurve',
      'raidProgression',
      'realmSlug',
      'region',
      'stale',
    ]);
    expect(raid.body.raidAchievementCurve).toEqual([
      { raid: 'tier-mn-1', aotc: '2026-04-22T01:53:00.000Z' },
    ]);
    // A part, not the page: nothing to push.
    expect(syncs()).toHaveLength(0);

    await lookup('&raidProgression=tier-mn-1');
    expect(raiderIo()).toHaveLength(1);
  });

  it('asks for a raid and a season in one Raider.io request', async () => {
    const both = await lookup('&raidProgression=tier-mn-1&mplusSeasonScore=season-mn-2');

    expect(raiderIo()).toHaveLength(1);
    expect(fieldsOf(raiderIo()[0])).toEqual([
      'mythic_plus_scores_by_season:season-mn-2',
      'raid_achievement_curve:tier-mn-1',
      'raid_progression:tier-mn-1',
    ]);
    expect(both.body).toMatchObject({
      raidProgression: { 'tier-mn-1': { total_bosses: 9 } },
      raidAchievementCurve: [{ raid: 'tier-mn-1' }],
      mythicPlusScores: [{ season: 'season-mn-2' }],
    });
  });

  it('fetches only the missing part when a raid and a season are asked together', async () => {
    await lookup('&mplusSeasonScore=season-mn-2');
    const both = await lookup('&raidProgression=tier-mn-1&mplusSeasonScore=season-mn-2');

    expect(raiderIo()).toHaveLength(2);
    expect(fieldsOf(raiderIo()[1])).toEqual([
      'raid_achievement_curve:tier-mn-1',
      'raid_progression:tier-mn-1',
    ]);
    expect(both.body).toMatchObject({
      raidProgression: { 'tier-mn-1': { total_bosses: 9 } },
      mythicPlusScores: [{ season: 'season-mn-2' }],
    });
    expect(both.body).not.toHaveProperty('gear');
  });

  it('refuses a raid or season the catalogue does not hold, without asking Raider.io', async () => {
    const response = await lookup('&raidProgression=no-such-raid&mplusSeasonScore=season-zz-9');

    expect(response.status).toBe(400);
    expect(response.body.issues.map((issue: Json) => issue.path)).toEqual([
      'raidProgression',
      'mplusSeasonScore',
    ]);
    expect(raiderIo()).toHaveLength(0);
  });

  it('answers 404 for a character Raider.io does not know, and caches nothing', async () => {
    const response = await fetch(
      `${app.url}/pve/character?region=us&realmSlug=demon-soul&characterName=Nobody`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(404);
    expect(
      await app.app.get(CacheService).get('pve:character:us:demon-soul:nobody:full'),
    ).toBeNull();
  });

  it('honours forceRefresh once per cooldown', async () => {
    await lookup();
    await lookup('&forceRefresh=true');
    await lookup('&forceRefresh=true');

    expect(raiderIo()).toHaveLength(2);
  });

  describe('with the Raider.io budget spent', () => {
    async function spendBudget(): Promise<void> {
      const budget = app.app.get(RaiderIoBudget);
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
      const full = (await cache.get<Json>(FULL_KEY))!;
      await cache.set(FULL_KEY, { ...full, fetchedAt: '2026-01-01T00:00:00.000Z' });

      await spendBudget();
      app.upstream.requests.length = 0;
      const response = await lookup();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ stale: true, fetchedAt: '2026-01-01T00:00:00.000Z' });
      expect(raiderIo()).toHaveLength(0);
    });

    it('answers 503 with Retry-After when nothing is cached', async () => {
      await spendBudget();
      const response = await lookup('&mplusSeasonScore=season-mn-2');

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('60');
    });
  });
});
