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

const LIVE = 'season-mn-2';
const PAST = 'season-mn-1';

const DUNGEONS = {
  mr: { id: 1, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
  don: { id: 2, name: 'Den of Nalorakk', slug: 'den-of-nalorakk', shortName: 'DON' },
  mc: { id: 3, name: 'Maisara Caverns', slug: 'maisara-caverns', shortName: 'MC' },
};

let id = 0;
const run = (
  season: string,
  region: string,
  score: number,
  dungeon: keyof typeof DUNGEONS,
  extra: Record<string, unknown> = {},
) => {
  id++;
  return {
    season,
    region,
    keystoneRunId: id,
    rank: 999,
    score,
    dungeon: DUNGEONS[dungeon],
    mythicLevel: 20,
    clearTimeMs: 1_800_000,
    keystoneTimeMs: 2_040_000,
    timeRemainingMs: 240_000,
    numChests: 1,
    completedAt: new Date('2026-10-09T00:24:13Z'),
    affixIds: [9, 10, 147],
    faction: 'horde',
    roster: [
      {
        rioCharacterId: id,
        characterName: `Char${id}`,
        realmSlug: 'realm',
        realmId: 1,
        region,
        classId: 8,
        className: 'Mage',
        specId: 62,
        specName: 'Arcane',
        role: 'dps',
        faction: 'horde',
        anonymized: false,
      },
    ],
    rosterKeys: [`${region}/realm/char${id}`],
    fetchedAt: new Date(),
    ...extra,
  };
};

async function runs(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-runs?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const scores = (body: Json) => body.runs.map((r: Json) => r.score);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Rankwarden's run board indexes, which the reads hint by name.
  await db.collection('mplus_runs').createIndexes([
    { key: { season: 1, region: 1, score: -1 }, name: 'run_board' },
    { key: { season: 1, region: 1, 'dungeon.id': 1, score: -1 }, name: 'run_dungeon_board' },
  ]);
  await db.collection('mplus_archive_runs').createIndexes([
    { key: { season: 1, score: -1 }, name: 'archive_run_board' },
    { key: { season: 1, region: 1, score: -1 }, name: 'archive_run_region_board' },
    { key: { season: 1, 'dungeon.id': 1, score: -1 }, name: 'archive_run_dungeon_board' },
  ]);

  await db.collection('mplus_seasons').insertMany([
    {
      slug: LIVE,
      name: 'MN Season 2',
      expansionId: 11,
      starts: { us: new Date('2026-08-18') },
      dungeonIds: [1, 2],
    },
    {
      slug: PAST,
      name: 'MN Season 1',
      expansionId: 11,
      starts: { us: new Date('2026-03-03') },
      dungeonIds: [3, 2],
    },
  ]);
  await db
    .collection('mplus_dungeons')
    .insertMany(Object.values(DUNGEONS).map((dungeon) => ({ ...dungeon, expansionIds: [11] })));
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );

  await db.collection('mplus_runs').insertMany([
    run(LIVE, 'eu', 550, 'don'),
    run(LIVE, 'cn', 548, 'don'),
    run(LIVE, 'us', 546, 'mr'),
    run(LIVE, 'eu', 540, 'mr'),
    run(LIVE, 'kr', 530, 'don'),
    // About to be pruned: never on the board.
    run(LIVE, 'us', 600, 'mr', { missedSince: new Date() }),
  ]);
  await db
    .collection('mplus_archive_runs')
    .insertMany([
      run(PAST, 'us', 580, 'mc'),
      run(PAST, 'eu', 570, 'mc'),
      run(PAST, 'eu', 560, 'don'),
    ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/mplus-runs', () => {
  it('ranks the current season’s runs across every region by default', async () => {
    const { status, body } = await runs();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'world',
      season: LIVE,
      current: true,
      dungeon: null,
      page: 1,
      pageSize: 50,
      total: 5,
      totalPages: 1,
    });
    // The 600 is about to be pruned.
    expect(scores(body)).toEqual([550, 548, 546, 540, 530]);
  });

  it('gives each run as stored, with its rank and roster', async () => {
    const { body } = await runs('pageSize=1');

    expect(body.runs[0]).toEqual({
      rank: 1,
      keystoneRunId: expect.any(Number),
      region: 'eu',
      score: 550,
      dungeon: DUNGEONS.don,
      mythicLevel: 20,
      clearTimeMs: 1_800_000,
      keystoneTimeMs: 2_040_000,
      timeRemainingMs: 240_000,
      numChests: 1,
      completedAt: '2026-10-09T00:24:13.000Z',
      affixIds: [9, 10, 147],
      faction: 'horde',
      roster: [
        expect.objectContaining({ className: 'Mage', specName: 'Arcane', anonymized: false }),
      ],
    });
    expect(body.runs[0]).not.toHaveProperty('rosterKeys');
  });

  it('pages, with ranks carrying on', async () => {
    const { body } = await runs('pageSize=2&page=2');

    expect(body).toMatchObject({ total: 5, totalPages: 3 });
    expect(body.runs.map((r: Json) => [r.rank, r.score])).toEqual([
      [3, 546],
      [4, 540],
    ]);
  });

  it('narrows to a region, a dungeon, or both', async () => {
    expect(scores((await runs('region=EU')).body)).toEqual([550, 540]);
    expect(scores((await runs('dungeon=murder-row')).body)).toEqual([546, 540]);

    const both = await runs('region=eu&dungeon=den-of-nalorakk');
    expect(both.body).toMatchObject({ region: 'eu', dungeon: 'den-of-nalorakk', total: 1 });
    expect(scores(both.body)).toEqual([550]);
  });

  it('reads a past season from the archive, world, region and dungeon', async () => {
    const world = await runs(`season=${PAST}`);
    expect(world.body).toMatchObject({ season: PAST, current: false, total: 3 });
    expect(scores(world.body)).toEqual([580, 570, 560]);

    expect(scores((await runs(`season=${PAST}&region=eu`)).body)).toEqual([570, 560]);
    expect(scores((await runs(`season=${PAST}&region=eu&dungeon=maisara-caverns`)).body)).toEqual([
      570,
    ]);
  });

  it('404 for a dungeon the season does not run, or an unknown season', async () => {
    const dungeon = await runs(`season=${PAST}&dungeon=murder-row`);
    expect(dungeon.status).toBe(404);
    expect(dungeon.body.message).toBe(`No dungeon murder-row in ${PAST}`);

    expect((await runs('season=season-nope')).status).toBe(404);
  });

  it('400 for an unknown region, a page past row 200,000, or a bad page size', async () => {
    for (const query of ['region=xx', 'page=4002&pageSize=50', 'pageSize=101', 'dungeon=No%20pe']) {
      expect((await runs(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-runs`)).status).toBe(401);
  });
});
