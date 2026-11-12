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

const PROFILES = {
  hpal: { classId: 2, className: 'Paladin', specId: 65, specName: 'Holy', role: 'healer' },
  arms: { classId: 1, className: 'Warrior', specId: 71, specName: 'Arms', role: 'dps' },
  fire: { classId: 8, className: 'Mage', specId: 63, specName: 'Fire', role: 'dps' },
} as const;

let n = 0;
const character = (
  region: string,
  mythicScore: number,
  profile: keyof typeof PROFILES,
  isFullyCovered = true,
) => {
  n++;
  return {
    season: LIVE,
    region,
    key: `${region}/realm/c${n}`,
    characterName: `C${n}`,
    realmSlug: 'realm',
    profile: PROFILES[profile],
    mythicScore,
    isFullyCovered,
    dungeonsCovered: isFullyCovered ? 8 : 1,
  };
};
const many = (count: number, ...args: Parameters<typeof character>) =>
  Array.from({ length: count }, () => character(...args));

async function tierList(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/tier-list?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const bySpec = (body: Json, spec: string) => body.specs.find((s: Json) => s.spec === spec);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Rankwarden's indexes, which the reads hint by name.
  await db.collection('mplus_characters').createIndexes([
    { key: { season: 1, region: 1, mythicScore: -1 }, name: 'mplus_score_board' },
    { key: { season: 1, isFullyCovered: 1, mythicScore: -1 }, name: 'mplus_covered_board' },
    {
      key: { season: 1, region: 1, isFullyCovered: 1, mythicScore: -1 },
      name: 'mplus_covered_region_board',
    },
  ]);

  await db
    .collection('mplus_seasons')
    .insertOne({ slug: LIVE, name: 'MN Season 2', expansionId: 11, starts: { us: new Date() } });
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );

  await db.collection('mplus_characters').insertMany([
    // Holy paladins lead the board and are the most played.
    ...many(30, 'eu', 3900, 'hpal'),
    ...many(30, 'us', 3700, 'hpal'),
    // Arms: fewer, lower.
    ...many(20, 'us', 3600, 'arms'),
    // Partial scores: on the board's top rows, never in representation or average.
    ...many(40, 'kr', 3000, 'arms', false),
    // A fully covered fire mage below Keystone Master: not counted either.
    character('eu', 1900, 'fire'),
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/tier-list', () => {
  it('ranks every spec of the current season, in the PvP tier list’s shape', async () => {
    const { status, body } = await tierList();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'world',
      season: LIVE,
      seasonName: 'MN Season 2',
      minScore: 2000,
      // Every character is on the board's top rows.
      topRows: 121,
      topClassified: 121,
      // Only the 80 fully covered at or above 2000.
      classified: 80,
    });
    expect(body.specs).toHaveLength(40);
    expect(body.specs[0]).toMatchObject({ class: 'paladin', spec: 'holy' });
    expect(Object.keys(body.specs[0])).toEqual([
      'class',
      'spec',
      'tier',
      'score',
      'topDensity',
      'representation',
      'averageRating',
    ]);
  });

  it('counts partial scores in the top rows, but not in representation or average', async () => {
    const { body } = await tierList();
    const arms = bySpec(body, 'arms');

    // 20 covered in the top 250, and the 40 partial ones behind them.
    expect(arms.topDensity).toMatchObject({ top250: 60 });
    expect(arms.representation).toMatchObject({ count: 20, share: 0.25 });
    expect(arms.averageRating.value).toBe(3600);
  });

  it('leaves a spec below Keystone Master out of representation and average', async () => {
    const fire = bySpec((await tierList()).body, 'fire');

    expect(fire.topDensity.top250).toBe(1);
    expect(fire.representation).toEqual({ count: 0, share: 0, score: 0 });
    expect(fire.averageRating).toEqual({ value: null, adjusted: null, score: 0 });
  });

  it('weighs the average by count toward 2000', async () => {
    const hpal = bySpec((await tierList()).body, 'holy');

    // 30 at 3900 and 30 at 3700; (60 × 3800 + 50 × 2000) / 110.
    expect(hpal.averageRating).toMatchObject({ value: 3800, adjusted: 2981.8 });
  });

  it('answers one region', async () => {
    const { body } = await tierList('region=US');

    expect(body).toMatchObject({ region: 'us', topRows: 50, classified: 50 });
    expect(bySpec(body, 'holy').representation.count).toBe(30);
  });

  it('404 without a character in the region; 400 for an unknown region', async () => {
    const { status, body } = await tierList('region=tw');
    expect(status).toBe(404);
    expect(body.message).toBe(`No Mythic+ characters with a known spec yet for ${LIVE} in tw`);

    expect((await tierList('region=xx')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/tier-list`)).status).toBe(401);
  });
});
