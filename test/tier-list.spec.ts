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
let nextId = 1;

const row = (rating: number, cls: string | null, spec: string | null, extra = {}) => ({
  seasonId: 42,
  region: 'eu',
  bracket: cls ? `shuffle-${cls}-${spec}` : '3v3',
  characterId: nextId++,
  rating,
  class: cls,
  spec,
  ...extra,
});

const many = (count: number, rating: number, cls: string | null, spec: string | null) =>
  Array.from({ length: count }, () => row(rating, cls, spec));

async function tierList(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/tier-list?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('season_state').insertMany([
    { region: 'eu', seasonId: 42, name: 'Season 42', startsAt: new Date(), endsAt: null },
    { region: 'us', seasonId: 42, name: 'Season 42', startsAt: new Date(), endsAt: null },
  ]);

  await db.collection('shuffle_ratings').insertMany([
    // Discipline holds the top 250 and the most rows; arms the next 250.
    ...many(250, 2800, 'priest', 'discipline'),
    ...many(250, 2700, 'warrior', 'arms'),
    ...many(600, 1900, 'priest', 'discipline'),
    ...many(100, 1600, 'warrior', 'arms'),
    // Few players, the best average: a high average rating is not enough.
    ...many(20, 2300, 'mage', 'fire'),
    // Below 1500: in the top rows of this short ladder, but in no representation.
    ...many(5, 1400, 'druid', 'balance'),
    // Another season and another region.
    row(3000, 'rogue', 'subtlety', { seasonId: 41 }),
    row(3000, 'rogue', 'subtlety', { region: 'us' }),
  ]);

  await db.collection('3v3_ratings').insertMany([
    // Not enriched: holds the top place without a spec.
    row(2900, null, null),
    row(2400, 'mage', 'frost'),
    row(1450, 'druid', 'balance'),
  ]);

  // A ladder Rankwarden has not enriched at all.
  await db.collection('2v2_ratings').insertMany([row(2000, null, null)]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/tier-list', () => {
  it('ranks the specs of the current season best first, with what each factor gave', async () => {
    const { status, body } = await tierList('region=eu&bracket=shuffle');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'eu',
      bracket: 'shuffle',
      seasonId: 42,
      seasonName: 'Season 42',
      minRating: 1500,
      topRows: 1225,
      topClassified: 1225,
      classified: 1220,
    });
    // All 40 specs, the four with rows first.
    expect(body.specs).toHaveLength(40);
    expect(body.specs.slice(0, 4).map((s: Json) => `${s.class}-${s.spec}`)).toEqual([
      'priest-discipline',
      'warrior-arms',
      'mage-fire',
      'druid-balance',
    ]);

    const [discipline, arms] = body.specs;
    expect(discipline).toMatchObject({
      tier: 'S',
      // Leads every band.
      topDensity: { top250: 250, top500: 250, top1000: 730, top5000: 850, score: 45 },
      representation: { count: 850, share: 0.6967, score: 35 },
      // 250 at 2800 and 600 at 1900, with 50 more at 1500: second of the averages.
      averageRating: { value: 2164.7, adjusted: 2127.8, score: 19.49 },
    });
    expect(discipline.score).toBe(99.49);
    // 0 + 0.25 + 0.2 × 250/730 + 0.15 × 350/850 + 0.1 × 350/850 of 45, then 35 × 38/39 and 20.
    expect(arms).toMatchObject({
      tier: 'S',
      topDensity: { top250: 0, top500: 250, top1000: 250, score: 18.96 },
      representation: { score: 34.1 },
      averageRating: { value: 2385.7, adjusted: 2275, score: 20 },
      score: 73.07,
    });

    // Fire's 20 players average 2300, above discipline's 2164.7, but rank after it.
    expect(body.specs[2].averageRating).toEqual({ value: 2300, adjusted: 1728.6, score: 18.97 });

    // Below 1500, so no representation or average, but in this short ladder's top rows.
    expect(body.specs[3]).toMatchObject({
      spec: 'balance',
      topDensity: { top5000: 5 },
      representation: { count: 0, share: 0, score: 0 },
      averageRating: { value: null, adjusted: null, score: 0 },
    });
  });

  it('lists a spec with no row at all last, with nothing from any factor', async () => {
    const { body } = await tierList('region=eu&bracket=shuffle');
    const protection = body.specs.find(
      (s: Json) => s.class === 'warrior' && s.spec === 'protection',
    );

    expect(protection).toEqual({
      class: 'warrior',
      spec: 'protection',
      tier: expect.any(String),
      score: 0,
      topDensity: { top250: 0, top500: 0, top1000: 0, top2500: 0, top5000: 0, score: 0 },
      representation: { count: 0, share: 0, score: 0 },
      averageRating: { value: null, adjusted: null, score: 0 },
    });
    expect(body.specs.at(-1)).toMatchObject({ tier: 'D', score: 0 });
  });

  it('keeps an unclassified row in its place without counting it for a spec', async () => {
    const { status, body } = await tierList('region=eu&bracket=3v3');

    expect(status).toBe(200);
    expect(body).toMatchObject({ topRows: 3, topClassified: 2, classified: 1 });
    expect(body.specs[0]).toMatchObject({
      class: 'mage',
      spec: 'frost',
      topDensity: { top250: 1 },
      representation: { count: 1, share: 1 },
    });
  });

  it('reuses the computed list until it expires', async () => {
    const first = await tierList('region=eu&bracket=shuffle');
    await db.collection('shuffle_ratings').insertOne(row(3500, 'mage', 'arcane'));
    const second = await tierList('region=eu&bracket=shuffle');

    expect(second.body.computedAt).toBe(first.body.computedAt);
    // Arcane's new 3500 is not seen until the list expires.
    expect(second.body.specs.find((s: Json) => s.spec === 'arcane').score).toBe(0);
  });

  it('404 when no row of the ladder has a spec, or the region has no season', async () => {
    const unenriched = await tierList('region=eu&bracket=2v2');
    expect(unenriched.status).toBe(404);
    expect(unenriched.body.message).toContain('No 2v2 rows with a known spec');

    expect((await tierList('region=kr&bracket=shuffle')).status).toBe(404);
  });

  it('400 for an unknown bracket or region', async () => {
    expect((await tierList('region=eu&bracket=5v5')).status).toBe(400);
    expect((await tierList('region=cn&bracket=shuffle')).status).toBe(400);
    expect((await tierList('region=eu')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pvp/tier-list?region=eu&bracket=shuffle`)).status).toBe(401);
  });
});
