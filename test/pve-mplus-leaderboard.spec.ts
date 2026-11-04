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

const PROFILES = {
  arcane: { classId: 8, className: 'Mage', specId: 62, specName: 'Arcane', role: 'dps' },
  fire: { classId: 8, className: 'Mage', specId: 63, specName: 'Fire', role: 'dps' },
  holy: { classId: 5, className: 'Priest', specId: 257, specName: 'Holy', role: 'healer' },
  disc: { classId: 5, className: 'Priest', specId: 256, specName: 'Discipline', role: 'healer' },
  blood: { classId: 6, className: 'Death Knight', specId: 250, specName: 'Blood', role: 'tank' },
} as const;

let n = 0;
const character = (
  season: string,
  region: string,
  mythicScore: number,
  profile: keyof typeof PROFILES,
) => {
  n++;
  return {
    season,
    seasonId: season === LIVE ? 18 : 17,
    region,
    key: `${region}/realm/char${n}`,
    realmSlug: 'realm',
    realmName: 'Realm',
    nameKey: `char${n}`,
    characterName: `Char${n}`,
    searchName: `char${n}`,
    characterType: 'M+',
    rioCharacterId: n,
    realmId: 1,
    faction: 'horde',
    profile: { ...PROFILES[profile], raceId: 1, raceName: 'Human', level: 90 },
    mythicScore,
    dungeonsCovered: 1,
    dungeonRuns: [
      {
        dungeon: { id: 1, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
        keystoneRunId: n,
        mythicLevel: 20,
        score: mythicScore,
        clearTimeMs: 1_800_000,
        timeRemainingMs: 100_000,
        numChests: 1,
        completedAt: new Date('2026-10-09T00:24:13Z'),
        specId: PROFILES[profile].specId,
        role: PROFILES[profile].role,
      },
    ],
    updatedAt: new Date(),
  };
};

async function board(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-leaderboard?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const scores = (body: Json) => body.entries.map((e: Json) => e.mythicScore);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Rankwarden's indexes, which the reads hint by name.
  await db
    .collection('mplus_characters')
    .createIndex({ season: 1, region: 1, mythicScore: -1 }, { name: 'mplus_score_board' });
  await db
    .collection('mplus_archive_characters')
    .createIndex({ season: 1, mythicScore: -1 }, { name: 'archive_score_board' });
  await db
    .collection('mplus_archive_characters')
    .createIndex({ season: 1, region: 1, mythicScore: -1 }, { name: 'archive_score_region_board' });

  await db.collection('mplus_seasons').insertMany([
    { slug: LIVE, name: 'MN Season 2', expansionId: 11, starts: { us: new Date('2026-08-18') } },
    { slug: PAST, name: 'MN Season 1', expansionId: 11, starts: { us: new Date('2026-03-03') } },
  ]);
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );

  await db.collection('mplus_characters').insertMany([
    character(LIVE, 'eu', 4000, 'arcane'),
    character(LIVE, 'us', 3900, 'holy'),
    character(LIVE, 'kr', 3800, 'fire'),
    character(LIVE, 'eu', 3700, 'disc'),
    character(LIVE, 'cn', 3600, 'blood'),
    character(LIVE, 'us', 3500, 'arcane'),
    // A past season's row left in the live collection: never on the live board.
    character(PAST, 'eu', 9999, 'arcane'),
  ]);
  await db
    .collection('mplus_archive_characters')
    .insertMany([
      character(PAST, 'us', 4400, 'blood'),
      character(PAST, 'eu', 4300, 'holy'),
      character(PAST, 'us', 4200, 'arcane'),
    ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/mplus-leaderboard', () => {
  it('ranks the current season across every region by default', async () => {
    const { status, body } = await board();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'world',
      season: LIVE,
      current: true,
      class: null,
      spec: null,
      role: null,
      page: 1,
      pageSize: 50,
      total: 6,
      totalPages: 1,
    });
    expect(scores(body)).toEqual([4000, 3900, 3800, 3700, 3600, 3500]);
  });

  it('gives each entry the stored fields and its rank', async () => {
    const { body } = await board('pageSize=1');

    expect(body.entries[0]).toEqual({
      rank: 1,
      characterName: expect.stringMatching(/^Char\d+$/),
      realmName: 'Realm',
      realmSlug: 'realm',
      region: 'eu',
      faction: 'horde',
      mythicScore: 4000,
      profile: {
        classId: 8,
        className: 'Mage',
        specId: 62,
        specName: 'Arcane',
        role: 'dps',
        raceId: 1,
        raceName: 'Human',
        level: 90,
      },
      dungeonRuns: [
        expect.objectContaining({
          dungeon: { id: 1, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
          completedAt: '2026-10-09T00:24:13.000Z',
        }),
      ],
    });
  });

  it('pages, with ranks carrying on from page to page', async () => {
    const { body } = await board('pageSize=2&page=2');

    expect(body).toMatchObject({ page: 2, pageSize: 2, total: 6, totalPages: 3 });
    expect(body.entries.map((e: Json) => [e.rank, e.mythicScore])).toEqual([
      [3, 3800],
      [4, 3700],
    ]);
  });

  it('narrows to a region', async () => {
    const { body } = await board('region=EU');

    expect(body.region).toBe('eu');
    expect(scores(body)).toEqual([4000, 3700]);
  });

  it('filters by class, class and spec, role, and class and role', async () => {
    expect(scores((await board('class=mage')).body)).toEqual([4000, 3800, 3500]);
    expect(scores((await board('class=mage&spec=arcane')).body)).toEqual([4000, 3500]);
    expect(scores((await board('role=healer')).body)).toEqual([3900, 3700]);
    expect(scores((await board('class=priest&role=healer')).body)).toEqual([3900, 3700]);
    expect(scores((await board('class=mage&role=healer')).body)).toEqual([]);
    expect((await board('class=deathknight&spec=blood')).body).toMatchObject({
      class: 'deathknight',
      spec: 'blood',
      total: 1,
    });
  });

  it('reads a past season from the archive, world or one region', async () => {
    const world = await board(`season=${PAST}`);
    expect(world.body).toMatchObject({ season: PAST, current: false, total: 3 });
    expect(scores(world.body)).toEqual([4400, 4300, 4200]);

    expect(scores((await board(`season=${PAST}&region=us&role=dps`)).body)).toEqual([4200]);
  });

  it('reads the live collection when the current season is named', async () => {
    const { body } = await board(`season=${LIVE}`);

    expect(body).toMatchObject({ season: LIVE, current: true, total: 6 });
  });

  it('404 for a season the catalogue does not know', async () => {
    const { status, body } = await board('season=season-nope');

    expect(status).toBe(404);
    expect(body.message).toBe('No Mythic+ season season-nope in the catalogue');
  });

  it('400 for spec without class, spec with role, or a spec of another class', async () => {
    const cases = {
      'spec=fire': 'needs class',
      'class=priest&spec=holy&role=healer': 'cannot be combined with spec',
      'class=mage&spec=holy': 'is not a mage spec',
    };
    for (const [query, message] of Object.entries(cases)) {
      const { status, body } = await board(query);
      expect(status, query).toBe(400);
      expect(body.issues[0].message, query).toBe(message);
    }
    for (const query of ['region=xx', 'role=support', 'class=bard', 'pageSize=101', 'page=0']) {
      expect((await board(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-leaderboard`)).status).toBe(401);
  });
});
