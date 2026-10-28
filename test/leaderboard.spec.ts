import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const reward = (bracket: string, ratingCutoff: number, faction: string | null = null) => ({
  bracket,
  faction,
  ratingCutoff,
  title: `${bracket} title`,
  achievementId: 1,
  specialization: null,
});

const profile = (cls: string, spec: string, hero: string) => ({
  class: { id: 1, name: cls },
  spec: { id: 2, name: spec },
  heroTalentTree: { id: 3, name: hero },
  talentLoadouts: [{ spec: { id: 2, name: spec }, heroTalentTree: { id: 3, name: hero } }],
  gender: 'FEMALE',
  level: 90,
  race: { id: 4, name: 'Gnome' },
});

async function board(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/leaderboard?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Season 42 is live, 41 archived; one 3v3 cutoff per faction in 28.
  await db.collection('season_state').insertOne({
    region: 'eu',
    seasonId: 42,
    name: 'Season 42',
    startsAt: new Date('2026-08-18T15:00:00Z'),
    endsAt: null,
    rewards: [reward('3v3', 2500), reward('shuffle-mage-fire', 2400)],
  });
  await db.collection('archive_seasons').insertMany([
    {
      region: 'eu',
      seasonId: 41,
      name: 'Season 41',
      rewards: [reward('3v3', 2700), reward('shuffle-mage-fire', 2600)],
    },
    {
      region: 'eu',
      seasonId: 28,
      name: 'Season 28',
      rewards: [reward('3v3', 3000, 'ALLIANCE'), reward('3v3', 2900, 'HORDE')],
    },
  ]);

  // Live 3v3: three rows, one character not enriched yet; plus a different region.
  await db.collection('3v3_ratings').insertMany([
    {
      seasonId: 42,
      region: 'eu',
      bracket: '3v3',
      characterId: 1,
      rating: 2600,
      class: 'mage',
      spec: 'fire',
    },
    {
      seasonId: 42,
      region: 'eu',
      bracket: '3v3',
      characterId: 2,
      rating: 2550,
      class: 'warrior',
      spec: 'arms',
    },
    {
      seasonId: 42,
      region: 'eu',
      bracket: '3v3',
      characterId: 3,
      rating: 2100,
      class: null,
      spec: null,
    },
    {
      seasonId: 42,
      region: 'us',
      bracket: '3v3',
      characterId: 9,
      rating: 3500,
      class: 'mage',
      spec: 'frost',
    },
  ]);
  await db.collection('shuffle_ratings').insertMany([
    {
      seasonId: 42,
      region: 'eu',
      bracket: 'shuffle-mage-fire',
      characterId: 1,
      rating: 2450,
      class: 'mage',
      spec: 'fire',
    },
    {
      seasonId: 42,
      region: 'eu',
      bracket: 'shuffle-warrior-arms',
      characterId: 2,
      rating: 2500,
      class: 'warrior',
      spec: 'arms',
    },
  ]);
  await db.collection('characters').insertMany([
    {
      seasonId: 42,
      region: 'eu',
      characterId: 1,
      characterName: 'Biba',
      realmSlug: 'kazzak',
      faction: 'HORDE',
      profileStatus: 'ok',
      brackets: {
        '3v3': { rank: 1, rating: 2600, previousRating: 2550, played: 10, won: 7, lost: 3 },
        'shuffle-mage-fire': { rank: 1, rating: 2450, played: 60, won: 40, lost: 20 },
      },
      profile: profile('Mage', 'Fire', 'Sunfury'),
    },
    {
      seasonId: 42,
      region: 'eu',
      characterId: 2,
      characterName: 'Bob',
      realmSlug: 'draenor',
      faction: 'ALLIANCE',
      profileStatus: 'ok',
      brackets: {
        '3v3': { rank: 2, rating: 2550, played: 20, won: 11, lost: 9 },
        'shuffle-warrior-arms': { rank: 1, rating: 2500, played: 30, won: 18, lost: 12 },
      },
      profile: profile('Warrior', 'Arms', 'Slayer'),
    },
    {
      seasonId: 42,
      region: 'eu',
      characterId: 3,
      characterName: 'Fresh',
      realmSlug: 'kazzak',
      faction: 'HORDE',
      brackets: { '3v3': { rank: 3, rating: 2100, played: 5, won: 2, lost: 3 } },
    },
  ]);

  const archived = (
    seasonId: number,
    bracket: string,
    characterId: number,
    rating: number,
    faction: string,
  ) => ({
    seasonId,
    region: 'eu',
    bracket,
    characterId,
    characterName: `Old${characterId}`,
    realmId: 1,
    realmSlug: 'kazzak',
    faction,
    rank: characterId,
    rating,
    played: 50,
    won: 30,
    lost: 20,
  });
  await db
    .collection('archive_entries')
    .insertMany([
      archived(41, '3v3', 11, 2800, 'HORDE'),
      archived(41, '3v3', 12, 2650, 'ALLIANCE'),
      archived(41, 'shuffle-mage-fire', 13, 2700, 'HORDE'),
      archived(41, 'shuffle-warrior-arms', 14, 2750, 'ALLIANCE'),
      archived(28, '3v3', 15, 2950, 'HORDE'),
      archived(28, '3v3', 16, 2950, 'ALLIANCE'),
    ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/leaderboard — current season', () => {
  it('pages the live ladder, best first, enriched from characters', async () => {
    const { status, body } = await board('region=eu&seasonId=42&bracket=3v3');

    expect(status).toBe(200);
    expect(body).toMatchObject({ current: true, total: 3, totalPages: 1, page: 1, pageSize: 50 });
    expect(body.cutoff).toMatchObject({ rating: 2500 });
    expect(body.entries.map((e: Json) => e.characterId)).toEqual([1, 2, 3]);
    expect(body.entries[0]).toEqual({
      characterId: 1,
      characterName: 'Biba',
      realmSlug: 'kazzak',
      bracket: '3v3',
      rating: 2600,
      rank: 1,
      played: 10,
      won: 7,
      lost: 3,
      faction: 'horde',
      inTitleRange: true,
      previousRating: 2550,
      class: 'mage',
      spec: 'fire',
      gender: 'female',
      heroTalents: 'Sunfury',
      level: 90,
      profileStatus: 'ok',
      race: 'Gnome',
    });
  });

  it('answers nulls for what enrichment has not filled yet', async () => {
    const { body } = await board('region=eu&seasonId=42&bracket=3v3');

    expect(body.entries[2]).toMatchObject({
      characterName: 'Fresh',
      rank: 3,
      inTitleRange: false,
      class: null,
      heroTalents: null,
      profileStatus: null,
    });
  });

  it('pages with page and pageSize, and counts the whole board', async () => {
    const second = (await board('region=eu&seasonId=42&bracket=3v3&page=2&pageSize=2')).body;

    expect(second).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(second.entries.map((e: Json) => e.characterId)).toEqual([3]);

    const past = (await board('region=eu&seasonId=42&bracket=3v3&page=9&pageSize=2')).body;
    expect(past.entries).toEqual([]);
  });

  it('filters by class and spec', async () => {
    const { body } = await board('region=eu&seasonId=42&bracket=3v3&class=warrior');

    expect(body.entries.map((e: Json) => e.characterName)).toEqual(['Bob']);
    expect(body.total).toBe(1);
  });

  it('mixes every spec on a Shuffle board, each against its own cutoff', async () => {
    const { body } = await board('region=eu&seasonId=42&bracket=shuffle');

    expect(body.cutoff).toBeNull();
    expect(body.entries.map((e: Json) => [e.bracket, e.rank, e.inTitleRange])).toEqual([
      // No cutoff recorded for Arms this season.
      ['shuffle-warrior-arms', 1, false],
      ['shuffle-mage-fire', 1, true],
    ]);
    expect(body.entries[0]).toMatchObject({ heroTalents: 'Slayer', played: 30 });
  });

  it('serves one spec ladder by name or by class and spec alike', async () => {
    const byName = (await board('region=eu&seasonId=42&bracket=shuffle-mage-fire')).body;
    const byFilters = (await board('region=eu&seasonId=42&bracket=shuffle&class=mage&spec=fire'))
      .body;

    expect(byName.entries).toEqual(byFilters.entries);
    expect(byName.cutoff).toMatchObject({ rating: 2400 });
  });
});

describe('GET /pvp/leaderboard — archived season', () => {
  it('reads archive_entries, with no profile fields', async () => {
    const { body } = await board('region=eu&seasonId=41&bracket=3v3');

    expect(body).toMatchObject({ current: false, total: 2 });
    expect(body.entries[0]).toEqual({
      characterId: 11,
      characterName: 'Old11',
      realmSlug: 'kazzak',
      bracket: '3v3',
      rating: 2800,
      rank: 11,
      played: 50,
      won: 30,
      lost: 20,
      faction: 'horde',
      inTitleRange: true,
    });
    expect(body.entries[1].inTitleRange).toBe(false);
  });

  it('serves one archived spec ladder by class and spec, against its own cutoff', async () => {
    const { status, body } = await board(
      'region=eu&seasonId=41&bracket=shuffle&class=mage&spec=fire',
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ current: false, total: 1, cutoff: { rating: 2600 } });
    expect(body.entries).toEqual([
      expect.objectContaining({
        characterId: 13,
        bracket: 'shuffle-mage-fire',
        inTitleRange: true,
      }),
    ]);

    const byName = (await board('region=eu&seasonId=41&bracket=shuffle-mage-fire')).body;
    expect(byName.entries).toEqual(body.entries);
  });

  it("judges old faction-split cutoffs by the character's faction", async () => {
    const { body } = await board('region=eu&seasonId=28&bracket=3v3');

    const byFaction = Object.fromEntries(
      body.entries.map((e: Json) => [e.faction, e.inTitleRange]),
    );
    expect(byFaction).toEqual({ horde: true, alliance: false });
  });

  it('refuses class and spec filters on archived 2v2, 3v3 and RBG', async () => {
    expect((await board('region=eu&seasonId=41&bracket=3v3&class=mage')).status).toBe(400);
    expect((await board('region=eu&seasonId=41&bracket=rbg&class=mage&spec=fire')).status).toBe(
      400,
    );
  });

  it('refuses an archived Shuffle or Blitz board without both class and spec', async () => {
    expect((await board('region=eu&seasonId=41&bracket=shuffle')).status).toBe(400);
    expect((await board('region=eu&seasonId=41&bracket=shuffle&class=mage')).status).toBe(400);
    expect((await board('region=eu&seasonId=41&bracket=blitz')).status).toBe(400);
  });
});

describe('GET /pvp/leaderboard — refusals', () => {
  it('404 for a season the region does not have', async () => {
    expect((await board('region=eu&seasonId=7&bracket=3v3')).status).toBe(404);
  });

  it('400 for a missing or bad parameter', async () => {
    expect((await board('region=eu&bracket=3v3')).status).toBe(400);
    expect((await board('region=eu&seasonId=42&bracket=5v5')).status).toBe(400);
  });

  it('needs an access token', async () => {
    const response = await fetch(`${app.url}/pvp/leaderboard?region=eu&seasonId=42&bracket=3v3`);

    expect(response.status).toBe(401);
  });
});
