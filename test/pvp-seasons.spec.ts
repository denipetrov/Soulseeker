import { createClient } from 'redis';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PvpSeasonsService } from '../src/pvp/seasons/pvp-seasons.service.js';
import { bootTestApp, resetRedis, type TestApp } from './support/app.js';
import { openTestDatabase } from './support/database.js';
import { testRedisUrl } from './support/redis.js';

let app: TestApp;
let db: Db;
let drop: () => Promise<void>;
let seasons: PvpSeasonsService;

const rewards = (cutoff3v3: number) => [
  {
    bracket: '3v3',
    faction: null,
    ratingCutoff: cutoff3v3,
    title: 'Gladiator',
    achievementId: 1,
    specialization: null,
  },
  {
    bracket: 'shuffle-mage-fire',
    faction: null,
    ratingCutoff: 2492,
    title: 'Legend',
    achievementId: 2,
    specialization: { id: 63, name: 'Fire' },
  },
];

async function seed(): Promise<void> {
  await db.collection('archive_seasons').deleteMany({});
  await db.collection('season_state').deleteMany({});
  await db.collection('archive_seasons').insertMany([
    {
      region: 'eu',
      seasonId: 41,
      name: 'Season 41',
      startsAt: new Date('2026-03-18T04:00:00Z'),
      endsAt: new Date('2026-08-11T20:00:00Z'),
      archivedAt: new Date(),
      brackets: 83,
      entries: 309389,
      failedBrackets: [],
      rewards: rewards(3154),
    },
  ]);
  await db.collection('season_state').insertMany([
    {
      region: 'eu',
      seasonId: 42,
      name: 'Season 42',
      startsAt: new Date('2026-08-18T15:00:00Z'),
      endsAt: null,
      observedAt: new Date(),
      rewards: rewards(2858),
    },
  ]);
}

/** The TTL Redis holds for one of this service's keys. */
async function ttlOf(key: string): Promise<number> {
  const client = createClient({ url: testRedisUrl() });
  await client.connect();
  try {
    return await client.ttl(`${app.redisPrefix}cache:${key}`);
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  app = await bootTestApp();
  ({ db, drop } = await openTestDatabase(app.dbName));
  seasons = app.app.get(PvpSeasonsService);
});

beforeEach(async () => {
  await resetRedis(app);
  await seed();
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('PvpSeasonsService', () => {
  it('fills the cache from both collections on a miss, for an hour', async () => {
    const current = await seasons.currentSeason('eu');

    expect(current).toMatchObject({ seasonId: 42, current: true, final: false });
    expect(current?.cutoffs['3v3']?.rating).toBe(2858);

    // Every season is cached, not only the one asked for.
    expect(await ttlOf('pvp:season:eu:41')).toBeGreaterThan(3590);
    expect(await ttlOf('pvp:season:eu:42')).toBeGreaterThan(3590);
    expect(await ttlOf('pvp:seasons')).toBeGreaterThan(3590);
  });

  it('answers from the cache without MongoDB once filled', async () => {
    await seasons.season('eu', 41);
    await db.collection('archive_seasons').deleteMany({});
    await db.collection('season_state').deleteMany({});

    expect((await seasons.season('eu', 41))?.cutoffs['3v3']?.rating).toBe(3154);
    expect(await seasons.cutoff('eu', 42, 'shuffle-mage-fire')).toMatchObject({ rating: 2492 });
  });

  it('knows a season that does not exist from a cold cache', async () => {
    await seasons.season('eu', 41);
    // Gone from Mongo: if it reloaded, the season would vanish.
    await db.collection('archive_seasons').deleteMany({});

    expect(await seasons.season('eu', 7)).toBeNull();
    expect(await seasons.season('eu', 41)).not.toBeNull();
  });

  it('lists a region newest first, and nothing for a region without seasons', async () => {
    expect((await seasons.seasons('eu')).map((s) => s.seasonId)).toEqual([42, 41]);
    expect(await seasons.seasons('kr')).toEqual([]);
  });

  it('reloads after the cache is cleared, picking up changes', async () => {
    await seasons.season('eu', 42);
    await db
      .collection('season_state')
      .updateOne({ region: 'eu' }, { $set: { 'rewards.0.ratingCutoff': 2900 } });

    expect((await seasons.cutoff('eu', 42, '3v3'))?.rating).toBe(2858);

    await resetRedis(app);
    expect((await seasons.cutoff('eu', 42, '3v3'))?.rating).toBe(2900);
  });

  it('answers null for 2v2, which awards no title', async () => {
    expect(await seasons.cutoff('eu', 42, '2v2')).toBeNull();
  });
});
