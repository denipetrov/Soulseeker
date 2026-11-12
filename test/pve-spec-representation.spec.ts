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
const MR = { id: 1, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' };
const MC = { id: 3, name: 'Maisara Caverns', slug: 'maisara-caverns', shortName: 'MC' };

const share = (
  classId: number,
  className: string,
  specId: number,
  specName: string,
  role: string,
  count: number,
) => ({
  classId,
  className,
  specId,
  specName,
  role,
  count,
  percent: count / 10,
  rolePercent: count / 5,
});

const snapshot = (
  season: string,
  region: string,
  dungeon: typeof MR | null,
  extra: Record<string, unknown> = {},
) => ({
  season,
  seasonId: season === LIVE ? 18 : 17,
  region,
  dungeonId: dungeon?.id ?? null,
  dungeon,
  source: season === LIVE ? 'live' : 'archive',
  runs: 200,
  slots: 1000,
  classified: 1000,
  roles: { tank: 200, healer: 200, dps: 600 },
  // Stored least played first, to see the endpoint order them.
  specs: [
    share(8, 'Mage', 62, 'Arcane', 'dps', 90),
    share(6, 'Death Knight', 250, 'Blood', 'tank', 120),
  ],
  computedAt: new Date('2026-11-05T12:41:31Z'),
  ...extra,
});

async function representation(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/spec-representation?${query}`, {
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
      slug: LIVE,
      name: 'MN Season 2',
      expansionId: 11,
      starts: { us: new Date('2026-08-18') },
      dungeonIds: [1],
    },
    {
      slug: PAST,
      name: 'MN Season 1',
      expansionId: 11,
      starts: { us: new Date('2026-03-03') },
      dungeonIds: [3, 1],
    },
    {
      slug: 'season-tww-3',
      name: 'TWW Season 3',
      expansionId: 10,
      starts: { us: new Date('2025-08-12') },
      dungeonIds: [],
    },
  ]);
  await db.collection('mplus_dungeons').insertMany([
    { ...MR, expansionIds: [11] },
    { ...MC, expansionIds: [11] },
  ]);
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );

  await db
    .collection('mplus_spec_representation')
    .insertMany([
      snapshot(LIVE, 'all', null),
      snapshot(LIVE, 'all', MR, { runs: 25 }),
      snapshot(LIVE, 'eu', null, { runs: 40 }),
      snapshot(PAST, 'all', null, { runs: 100 }),
      snapshot(PAST, 'all', MC, { runs: 10 }),
      snapshot(PAST, 'all', MR, { runs: 12 }),
    ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/spec-representation', () => {
  it('answers the current season, every region and dungeon together, by default', async () => {
    const { status, body } = await representation();

    expect(status).toBe(200);
    expect(body).toEqual({
      region: 'world',
      season: LIVE,
      dungeon: 'all',
      source: 'live',
      computedAt: '2026-11-05T12:41:31.000Z',
      runs: 200,
      slots: 1000,
      classified: 1000,
      roles: { tank: 200, healer: 200, dps: 600 },
      // Most played first, with the slugs.
      specs: [
        {
          class: 'deathknight',
          spec: 'blood',
          ...share(6, 'Death Knight', 250, 'Blood', 'tank', 120),
        },
        { class: 'mage', spec: 'arcane', ...share(8, 'Mage', 62, 'Arcane', 'dps', 90) },
      ],
    });
  });

  it('answers one region and one dungeon', async () => {
    expect((await representation('region=EU')).body).toMatchObject({ region: 'eu', runs: 40 });
    expect((await representation('dungeonSlug=murder-row')).body).toMatchObject({
      dungeon: 'murder-row',
      runs: 25,
    });
  });

  it('answers a past season, from its archived snapshot', async () => {
    const { body } = await representation(`season=${PAST}&dungeonSlug=maisara-caverns`);

    expect(body).toMatchObject({
      season: PAST,
      dungeon: 'maisara-caverns',
      source: 'archive',
      runs: 10,
    });
  });

  it('lists the seasons with a snapshot for the region and dungeon, newest first', async () => {
    expect((await representation('getSeasons=true')).body.seasons).toEqual([LIVE, PAST]);
    expect((await representation('dungeonSlug=murder-row&getSeasons=true')).body.seasons).toEqual([
      LIVE,
      PAST,
    ]);
    expect((await representation('region=eu&getSeasons=true')).body.seasons).toEqual([LIVE]);
    expect((await representation()).body).not.toHaveProperty('seasons');
  });

  it('404 without a snapshot, for a dungeon the season does not run, or an unknown season', async () => {
    const missing = await representation('region=kr');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(`No spec representation for kr, all, in ${LIVE}`);

    expect((await representation('season=season-tww-3')).status).toBe(404);
    expect((await representation('dungeonSlug=maisara-caverns')).status).toBe(404);
    expect((await representation('season=season-nope')).status).toBe(404);
  });

  it('400 for an unknown region or a bad flag', async () => {
    expect((await representation('region=xx')).status).toBe(400);
    expect((await representation('getSeasons=yes')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/spec-representation`)).status).toBe(401);
  });
});
