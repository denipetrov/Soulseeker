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

const DAY_MS = 86_400_000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
/** UTC midnight `n` days before today. */
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY_MS);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const spec = (cls: string, name: string, count: number) => ({
  class: cls,
  spec: name,
  count,
  share: count / 100,
  heroTalentsClassified: count,
  heroTalents: [{ id: 1, name: 'Tree', count, share: 1 }],
});

const snapshot = (date: Date, extra: Record<string, unknown> = {}) => ({
  date,
  seasonId: 42,
  region: 'us',
  family: 'shuffle',
  minRating: 2100,
  total: 100,
  classified: 100,
  // Stored least played first, to see the endpoint order them.
  specs: [spec('mage', 'fire', 30), spec('priest', 'discipline', 70)],
  computedAt: new Date(date.getTime() + 8 * 3_600_000),
  ...extra,
});

async function history(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/spec-representation/history?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const base = 'region=us&bracket=shuffle&rating=2100';

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('spec_representation').insertMany([
    // One day past the window: the 31st day back.
    snapshot(daysAgo(31), { total: 999 }),
    // The window's first day, then a gap, then a rollover day with two seasons.
    snapshot(daysAgo(30)),
    snapshot(daysAgo(5), { seasonId: 41, total: 1 }),
    snapshot(daysAgo(5), { seasonId: 42, total: 55 }),
    snapshot(today, { total: 120 }),
    // Other keys on the same days.
    snapshot(daysAgo(3), { minRating: 1500 }),
    snapshot(daysAgo(3), { family: 'blitz' }),
    snapshot(daysAgo(3), { region: 'eu' }),
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/spec-representation/history', () => {
  it('lists the stored days of the last 31, today included, oldest first', async () => {
    const { status, body } = await history(base);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'us',
      bracket: 'shuffle',
      rating: 2100,
      from: iso(daysAgo(30)),
      to: iso(today),
    });
    // The 31st day back is outside; the gap is simply absent.
    expect(body.days.map((d: Json) => d.date)).toEqual([
      iso(daysAgo(30)),
      iso(daysAgo(5)),
      iso(today),
    ]);
  });

  it('gives each day its totals and specs, most played first, with their hero talents', async () => {
    const { body } = await history(base);
    const last = body.days.at(-1);

    expect(last).toEqual({
      date: iso(today),
      computedAt: new Date(today.getTime() + 8 * 3_600_000).toISOString(),
      total: 120,
      classified: 100,
      // Exactly as stored, hero talents included.
      specs: [spec('priest', 'discipline', 70), spec('mage', 'fire', 30)],
    });
    expect(last.specs[0]).toMatchObject({
      heroTalentsClassified: 70,
      heroTalents: [{ id: 1, name: 'Tree', count: 70, share: 1 }],
    });
  });

  it('takes the newer season on a day two seasons share', async () => {
    const { body } = await history(base);

    expect(body.days.find((d: Json) => d.date === iso(daysAgo(5))).total).toBe(55);
  });

  it('keeps region, bracket and rating apart', async () => {
    const { body } = await history('region=us&bracket=shuffle&rating=1500');

    expect(body.days.map((d: Json) => d.date)).toEqual([iso(daysAgo(3))]);
  });

  it('404 when the window holds no snapshot at all', async () => {
    const { status, body } = await history('region=kr&bracket=shuffle&rating=2100');

    expect(status).toBe(404);
    expect(body.message).toContain(`between ${iso(daysAgo(30))} and ${iso(today)}`);
  });

  it('400 for a rating that is not a tracked cutoff, or a date it does not take', async () => {
    expect((await history('region=us&bracket=shuffle&rating=2000')).status).toBe(400);
    expect((await history('region=us&bracket=5v5&rating=2100')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pvp/spec-representation/history?${base}`)).status).toBe(401);
  });
});
