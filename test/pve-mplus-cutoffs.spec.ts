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
const PATH = '/raiderio/mythic-plus/cutoff-analysis/summary';

/** Raider.io's answer, as it comes, extra fields and all. */
const analysis = (season: string, region: string) => ({
  season,
  region,
  snapshotDate: '2026-11-11',
  updatedAt: '2026-11-11T10:14:02.691Z',
  seasonStartDate: '2026-08-18',
  populations: [{ key: 'overall', faction: 'all', population: 728980 }],
  history: [
    { date: '2026-08-18', population: 83603, cutoffs: [{ percentile: 0.1, score: 2671.6 }] },
    { date: '2026-11-11', population: 728980, cutoffs: [{ percentile: 0.1, score: 4057.65 }] },
  ],
  revision: '23a4aa6c',
});

const requests = () => app.upstream.requestsTo(PATH);

async function cutoffs(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/mplus-cutoffs?${query}`, {
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
    const season = request.query.get('season')!;
    const region = request.query.get('region')!;
    if (region === 'tw')
      return { status: 404, body: { message: 'Unknown cutoff season or region.' } };
    if (region === 'kr') return { status: 500, body: {} };
    return { status: 200, body: analysis(season, region) };
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /pve/mplus-cutoffs', () => {
  it('passes Raider.io’s analysis on as it comes, for world and the current season', async () => {
    const { status, body } = await cutoffs();

    expect(status).toBe(200);
    expect(body).toEqual(analysis(LIVE, 'world'));
    expect(requests()[0]?.query.get('format')).toBe('json');
  });

  it('asks for the region and season given', async () => {
    await cutoffs(`region=EU&season=${PAST}`);

    expect(requests().map((r) => [r.query.get('season'), r.query.get('region')])).toEqual([
      [PAST, 'eu'],
    ]);
  });

  it('serves from the cache after the first time', async () => {
    await cutoffs('region=us');
    await cutoffs('region=us');

    expect(requests()).toHaveLength(1);
  });

  it('404 when Raider.io has no analysis, or for a season the catalogue does not know', async () => {
    const missing = await cutoffs('region=tw');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(`No Mythic+ cutoff analysis for ${LIVE} in tw`);

    expect((await cutoffs('season=season-nope')).status).toBe(404);
    // An unknown season never reaches Raider.io.
    expect(requests().map((r) => r.query.get('season'))).toEqual([LIVE]);
  });

  it('502 when Raider.io fails', async () => {
    expect((await cutoffs('region=kr')).status).toBe(502);
  });

  it('400 for an unknown region', async () => {
    expect((await cutoffs('region=xx')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/mplus-cutoffs`)).status).toBe(401);
  });
});
