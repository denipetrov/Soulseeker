import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
const PATH = '/raiderio/mythic-plus/run-details';

/** Raider.io's answer for a run: what is kept, and some of the ~1.2 MB that is not. */
const details = (season: string, id: number) => ({
  season,
  status: 'finished',
  dungeon: { type: 'dungeon', id: 16091, name: 'Murder Row', short_name: 'MR', slug: 'murder-row' },
  keystone_run_id: id,
  mythic_level: 22,
  clear_time_ms: 1824300,
  keystone_time_ms: 2040999,
  completed_at: '2026-10-09T00:24:13.000Z',
  num_chests: 1,
  time_remaining_ms: 216699,
  weekly_modifiers: [
    { id: 9, name: 'Tyrannical', slug: 'tyrannical', icon: 'achievement_boss_archaedas' },
  ],
  faction: 'alliance',
  score: 519,
  roster: [
    {
      character: { id: 1, name: 'Bondd', spec: { id: 262, name: 'Elemental' } },
      role: 'dps',
      items: { item_level_equipped: 300 },
    },
  ],
  logged_details: { encounters: ['…'] },
  videos: [],
  canManageOwnVideos: false,
});

const requests = () => app.upstream.requestsTo(PATH);

async function run(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-run?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({
    env: { RATE_LIMIT_API_PER_MINUTE: '1000', RAIDERIO_RETRY_LIMIT: '0' },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('mplus_seasons').insertMany([
    { slug: LIVE, name: 'MN Season 2', expansionId: 11, starts: { us: new Date('2026-08-18') } },
    { slug: PAST, name: 'MN Season 1', expansionId: 11, starts: { us: new Date('2026-03-03') } },
  ]);
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );
  await db.collection('mplus_runs').insertOne({ season: LIVE, region: 'us', keystoneRunId: 100 });
  await db
    .collection('mplus_archive_runs')
    .insertOne({ season: PAST, region: 'eu', keystoneRunId: 200 });

  token = (await anonymousTokens(app)).access_token;
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
    if (request.path !== PATH) return undefined;
    const id = Number(request.query.get('id'));
    if (id === 404) return { status: 404, body: { message: 'could not find keystone run' } };
    if (id === 500) return { status: 500, body: {} };
    return { status: 200, body: details(request.query.get('season')!, id) };
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /pve/mplus-run', () => {
  it('answers the run’s fields from Raider.io, the roster as it comes', async () => {
    const { status, body } = await run('keystoneRunId=100');

    expect(status).toBe(200);
    expect(body).toEqual({
      season: LIVE,
      keystone_run_id: 100,
      dungeon: {
        type: 'dungeon',
        id: 16091,
        name: 'Murder Row',
        short_name: 'MR',
        slug: 'murder-row',
      },
      mythic_level: 22,
      score: 519,
      clear_time_ms: 1824300,
      keystone_time_ms: 2040999,
      time_remaining_ms: 216699,
      num_chests: 1,
      completed_at: '2026-10-09T00:24:13.000Z',
      faction: 'alliance',
      weekly_modifiers: [
        { id: 9, name: 'Tyrannical', slug: 'tyrannical', icon: 'achievement_boss_archaedas' },
      ],
      roster: [
        {
          character: { id: 1, name: 'Bondd', spec: { id: 262, name: 'Elemental' } },
          role: 'dps',
          items: { item_level_equipped: 300 },
        },
      ],
    });
  });

  it('asks Raider.io for the season the run is stored under', async () => {
    await run('keystoneRunId=100');
    await run('keystoneRunId=200');
    // Neither stored: the current season.
    await run('keystoneRunId=300');

    expect(requests().map((r) => [r.query.get('id'), r.query.get('season')])).toEqual([
      ['100', LIVE],
      ['200', PAST],
      ['300', LIVE],
    ]);
  });

  it('asks for the season given, when one is', async () => {
    const { body } = await run(`keystoneRunId=100&season=${PAST}`);

    expect(body.season).toBe(PAST);
    expect(requests()[0]?.query.get('season')).toBe(PAST);
  });

  it('serves a run from the cache after the first time', async () => {
    await run('keystoneRunId=100');
    await run('keystoneRunId=100');

    expect(requests()).toHaveLength(1);
  });

  it('404 for a run Raider.io does not know, or an unknown season', async () => {
    const missing = await run('keystoneRunId=404');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(`No Mythic+ run 404 in ${LIVE}`);

    expect((await run('keystoneRunId=100&season=season-nope')).status).toBe(404);
  });

  it('502 when Raider.io fails', async () => {
    expect((await run('keystoneRunId=500')).status).toBe(502);
  });

  it('400 for a missing or invalid run id', async () => {
    for (const query of [
      '',
      'keystoneRunId=abc',
      'keystoneRunId=0',
      'keystoneRunId=100&season=No%20pe',
    ]) {
      expect((await run(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-run?keystoneRunId=100`)).status).toBe(401);
  });
});
