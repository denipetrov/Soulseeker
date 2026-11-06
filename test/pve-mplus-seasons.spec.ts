import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisService } from '../src/redis/redis.service.js';
import { MPLUS_SEASON_LIST_CACHE_KEY } from '../src/pve/mplus-seasons/mplus-seasons.service.js';
import { PveCatalogue } from '../src/seasons/pve-catalogue.service.js';
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

const OPEN = new Date('2030-01-01T00:00:00Z');

const dungeon = (id: number, slug: string, name: string) => ({
  id,
  slug,
  name,
  shortName: name.slice(0, 3).toUpperCase(),
  challengeModeId: id % 1000,
  keystoneTimerSeconds: 1800,
  iconUrl: `https://cdn.raiderio.net/icons/${slug}.jpg`,
  backgroundImageUrl: `https://cdn.raiderio.net/backgrounds/${slug}.jpg`,
  expansionIds: [11],
  updatedAt: new Date(),
});

const all = {
  quantile: 0.999,
  minScore: 4044.34,
  populationCount: 723,
  populationFraction: 0.001,
  totalPopulation: 722549,
};

async function seasons(): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-seasons`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('mplus_seasons').insertMany([
    {
      slug: 'season-mn-1',
      name: 'MN Season 1',
      shortName: 'MN1',
      expansionId: 11,
      blizzardSeasonId: 17,
      starts: { us: new Date('2026-03-03T15:00:00Z') },
      ends: { us: new Date('2026-08-11T15:00:00Z') },
      dungeonIds: [2, 1],
      catalogueUpdatedAt: new Date(),
      // Rankwarden's bookkeeping: never in the answer.
      archive: { status: 'complete' },
    },
    {
      slug: 'season-mn-2',
      name: 'MN Season 2',
      shortName: 'MN2',
      expansionId: 11,
      blizzardSeasonId: 18,
      starts: { us: new Date('2026-08-18T15:00:00Z'), eu: new Date('2026-08-19T04:00:00Z') },
      ends: { us: OPEN, eu: OPEN },
      // Its own order, and one id the dungeons collection lacks.
      dungeonIds: [3, 1, 999],
      catalogueUpdatedAt: new Date(),
      cutoffs: {
        us: {
          status: 'ok',
          updatedAt: new Date('2026-11-05T10:00:47Z'),
          keystones: { keystoneMaster: { score: 2000, alliance: null, horde: null, all } },
          quantiles: { p999: { score: null, alliance: null, horde: null, all } },
          fetchedAt: new Date(),
          attempts: 0,
          finalised: false,
        },
        eu: { status: 'missing', updatedAt: null, keystones: {}, quantiles: {} },
      },
    },
    {
      slug: 'season-tww-3',
      name: 'TWW Season 3',
      expansionId: 10,
      starts: { us: new Date('2025-08-12T15:00:00Z') },
      ends: { us: new Date('2026-02-24T15:00:00Z') },
      dungeonIds: [],
      catalogueUpdatedAt: new Date(),
    },
  ]);

  await db
    .collection('mplus_dungeons')
    .insertMany([
      dungeon(1, 'murder-row', 'Murder Row'),
      dungeon(2, 'maisara-caverns', 'Maisara Caverns'),
      dungeon(3, 'black-rook-hold', 'Black Rook Hold'),
    ]);

  await db.collection('mplus_affixes').insertMany([
    {
      id: 10,
      name: 'Fortified',
      slug: 'fortified',
      description: 'More health.',
      icon: 'ability_toughness',
      updatedAt: new Date(),
    },
    {
      id: 9,
      name: 'Tyrannical',
      slug: 'tyrannical',
      description: 'Bosses hit harder.',
      icon: 'achievement_boss_archaedas',
      updatedAt: new Date(),
    },
  ]);

  // The catalogue's own season list in Redis first, as on a running replica:
  // the answer must not be confused with it.
  await app.app.get(PveCatalogue).mplusSeasons();

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/mplus-seasons', () => {
  it('lists every season, newest first, with its regional dates', async () => {
    const { status, body } = await seasons();

    expect(status).toBe(200);
    expect(body.seasons.map((s: Json) => s.slug)).toEqual([
      'season-mn-2',
      'season-mn-1',
      'season-tww-3',
    ]);
    expect(body.seasons[0]).toMatchObject({
      name: 'MN Season 2',
      shortName: 'MN2',
      expansionId: 11,
      blizzardSeasonId: 18,
      starts: { us: '2026-08-18T15:00:00.000Z', eu: '2026-08-19T04:00:00.000Z' },
      // Running: Raider.io's placeholder end is null.
      ends: { us: null, eu: null },
    });
    expect(body.seasons[2]).toMatchObject({ shortName: null, blizzardSeasonId: null, cutoffs: {} });
    expect(body.seasons[1]).not.toHaveProperty('archive');
  });

  it('gives each season its dungeons in full, in its own order', async () => {
    const { body } = await seasons();
    const [current, past] = body.seasons;

    expect(current.dungeons.map((d: Json) => d.id)).toEqual([3, 1, 999]);
    expect(current.dungeons[0]).toEqual({
      id: 3,
      slug: 'black-rook-hold',
      name: 'Black Rook Hold',
      shortName: 'BLA',
      challengeModeId: 3,
      keystoneTimerSeconds: 1800,
      iconUrl: 'https://cdn.raiderio.net/icons/black-rook-hold.jpg',
      backgroundImageUrl: 'https://cdn.raiderio.net/backgrounds/black-rook-hold.jpg',
      expansionIds: [11],
    });
    // Not in mplus_dungeons: the id, with nulls.
    expect(current.dungeons[2]).toMatchObject({ id: 999, name: null, iconUrl: null });
    expect(past.dungeons.map((d: Json) => d.slug)).toEqual(['maisara-caverns', 'murder-row']);
  });

  it('gives the cutoffs per region, without the fetch bookkeeping', async () => {
    const { body } = await seasons();

    expect(body.seasons[0].cutoffs).toEqual({
      us: {
        status: 'ok',
        updatedAt: '2026-11-05T10:00:47.000Z',
        keystones: { keystoneMaster: { score: 2000, alliance: null, horde: null, all } },
        quantiles: { p999: { score: null, alliance: null, horde: null, all } },
      },
      eu: { status: 'missing', updatedAt: null, keystones: {}, quantiles: {} },
    });
  });

  it('lists every affix, by id', async () => {
    const { body } = await seasons();

    expect(body.affixes).toEqual([
      {
        id: 9,
        name: 'Tyrannical',
        slug: 'tyrannical',
        description: 'Bosses hit harder.',
        icon: 'achievement_boss_archaedas',
      },
      {
        id: 10,
        name: 'Fortified',
        slug: 'fortified',
        description: 'More health.',
        icon: 'ability_toughness',
      },
    ]);
  });

  it('keeps the answer in Redis, filled when missing', async () => {
    const redis = app.app.get(RedisService);
    const key = redis.key('cache', MPLUS_SEASON_LIST_CACHE_KEY);

    await seasons();
    expect(await redis.client.ttl(key)).toBeGreaterThan(0);

    await db.collection('mplus_affixes').insertOne({ id: 147, name: "Xal'atath's Guile" });
    expect((await seasons()).body.affixes).toHaveLength(2);

    await redis.client.del(key);
    expect((await seasons()).body.affixes).toHaveLength(3);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-seasons`)).status).toBe(401);
  });
});
