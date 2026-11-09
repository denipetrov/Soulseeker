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
};

const SLOTS = {
  blood: { classId: 6, className: 'Death Knight', specId: 250, specName: 'Blood', role: 'tank' },
  guardian: { classId: 11, className: 'Druid', specId: 104, specName: 'Guardian', role: 'tank' },
  hpal: { classId: 2, className: 'Paladin', specId: 65, specName: 'Holy', role: 'healer' },
  arms: { classId: 1, className: 'Warrior', specId: 71, specName: 'Arms', role: 'dps' },
  sub: { classId: 4, className: 'Rogue', specId: 261, specName: 'Subtlety', role: 'dps' },
  ele: { classId: 7, className: 'Shaman', specId: 262, specName: 'Elemental', role: 'dps' },
};
type Slot = keyof typeof SLOTS;

/** The meta party, in a roster order of its own each time. */
const META: Slot[] = ['ele', 'blood', 'sub', 'hpal', 'arms'];
const DRUID: Slot[] = ['guardian', 'hpal', 'arms', 'sub', 'ele'];

let id = 0;
const run = (
  season: string,
  region: string,
  score: number,
  dungeon: keyof typeof DUNGEONS,
  party: Slot[],
  extra: Record<string, unknown> = {},
) => {
  id++;
  return {
    season,
    region,
    keystoneRunId: id,
    score,
    dungeon: DUNGEONS[dungeon],
    mythicLevel: 20,
    completedAt: new Date(),
    affixIds: [],
    roster: party.map((slot, i) => ({
      ...SLOTS[slot],
      rioCharacterId: id * 10 + i,
      characterName: `C${id}${i}`,
      realmSlug: 'realm',
      region,
      anonymized: false,
    })),
    ...extra,
  };
};

async function compositions(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-compositions?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const counts = (body: Json) =>
  body.compositions.map((c: Json) => [c.members[0].spec, c.count, c.share]);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

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
      dungeonIds: [2],
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
    // The druid party holds the best run; the meta party the most.
    run(LIVE, 'eu', 560, 'mr', DRUID),
    run(LIVE, 'us', 550, 'don', META),
    run(LIVE, 'eu', 540, 'mr', [...META].reverse()),
    run(LIVE, 'kr', 530, 'don', META),
    run(LIVE, 'eu', 520, 'don', DRUID),
    // About to be pruned: not counted.
    run(LIVE, 'eu', 600, 'mr', DRUID, { missedSince: new Date() }),
  ]);
  await db
    .collection('mplus_archive_runs')
    .insertMany([run(PAST, 'us', 580, 'don', DRUID), run(PAST, 'eu', 570, 'don', DRUID)]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/mplus-compositions', () => {
  it('counts the best runs of the board by party make-up, most played first', async () => {
    const { status, body } = await compositions();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'world',
      season: LIVE,
      current: true,
      dungeon: null,
      top: 1000,
      runs: 5,
    });
    expect(counts(body)).toEqual([
      ['blood', 3, 0.6],
      ['guardian', 2, 0.4],
    ]);
  });

  it('lists each composition’s members tank, healer, then damage dealers', async () => {
    const { body } = await compositions();

    expect(body.compositions[0]).toEqual({
      rank: 1,
      count: 3,
      share: 0.6,
      members: [
        {
          class: 'deathknight',
          spec: 'blood',
          classId: 6,
          className: 'Death Knight',
          specId: 250,
          specName: 'Blood',
          role: 'tank',
        },
        {
          class: 'paladin',
          spec: 'holy',
          classId: 2,
          className: 'Paladin',
          specId: 65,
          specName: 'Holy',
          role: 'healer',
        },
        {
          class: 'warrior',
          spec: 'arms',
          classId: 1,
          className: 'Warrior',
          specId: 71,
          specName: 'Arms',
          role: 'dps',
        },
        {
          class: 'rogue',
          spec: 'subtlety',
          classId: 4,
          className: 'Rogue',
          specId: 261,
          specName: 'Subtlety',
          role: 'dps',
        },
        {
          class: 'shaman',
          spec: 'elemental',
          classId: 7,
          className: 'Shaman',
          specId: 262,
          specName: 'Elemental',
          role: 'dps',
        },
      ],
    });
  });

  it('reads only the top runs asked for', async () => {
    const { body } = await compositions('top=2');

    expect(body).toMatchObject({ top: 2, runs: 2 });
    // One run each: the tie goes to the composition of the better run.
    expect(counts(body)).toEqual([
      ['guardian', 1, 0.5],
      ['blood', 1, 0.5],
    ]);
  });

  it('narrows to a region and a dungeon, as the runs do', async () => {
    expect(counts((await compositions('region=eu')).body)).toEqual([
      ['guardian', 2, 0.6667],
      ['blood', 1, 0.3333],
    ]);
    expect(counts((await compositions('dungeon=den-of-nalorakk')).body)).toEqual([
      ['blood', 2, 0.6667],
      ['guardian', 1, 0.3333],
    ]);
  });

  it('reads a past season from the archive', async () => {
    const { body } = await compositions(`season=${PAST}`);

    expect(body).toMatchObject({ season: PAST, current: false, runs: 2 });
    expect(counts(body)).toEqual([['guardian', 2, 1]]);
  });

  it('404 for a dungeon the season does not run; 400 for a top out of range', async () => {
    expect((await compositions(`season=${PAST}&dungeon=murder-row`)).status).toBe(404);
    for (const query of ['top=0', 'top=10001', 'top=abc', 'region=xx']) {
      expect((await compositions(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-compositions`)).status).toBe(401);
  });
});
