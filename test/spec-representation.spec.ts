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

const spec = (cls: string, name: string, count: number) => ({
  class: cls,
  spec: name,
  count,
  share: count / 100,
  heroTalentsClassified: count,
  heroTalents: [{ id: 1, name: 'Tree', count, share: 1 }],
});

const snapshot = (date: string, extra: Record<string, unknown> = {}) => ({
  date: new Date(`${date}T00:00:00.000Z`),
  seasonId: 42,
  region: 'us',
  family: '3v3',
  minRating: 2100,
  total: 120,
  classified: 100,
  // Stored unsorted, to see the endpoint order them.
  specs: [spec('mage', 'fire', 30), spec('warrior', 'arms', 70)],
  computedAt: new Date(`${date}T08:00:00.000Z`),
  ...extra,
});

async function representation(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/spec-representation?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const base = 'region=us&bracket=3v3&rating=2100';

const DAY_MS = 86_400_000;
const midnight = new Date();
midnight.setUTCHours(0, 0, 0, 0);
/** `YYYY-MM-DD` of `days` UTC days before today. */
const ago = (days: number) =>
  new Date(midnight.getTime() - days * DAY_MS).toISOString().slice(0, 10);
/** Snapshots within the last 30 days, on a key of their own: EU RBG at 2100. */
const recent = (days: number, extra: Record<string, unknown> = {}) =>
  snapshot(ago(days), { region: 'eu', family: 'rbg', ...extra });
const recentBase = 'region=eu&bracket=rbg&rating=2100';

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('spec_representation').insertMany([
    // Counted but not classified yet: not a "filled" day.
    snapshot('2026-10-12', { classified: 0, specs: [] }),
    snapshot('2026-10-14'),
    snapshot('2026-10-20', { total: 130 }),
    // Other cutoffs, brackets and regions on the same days.
    snapshot('2026-10-10', { minRating: 1500 }),
    snapshot('2026-10-11', { family: 'shuffle' }),
    snapshot('2026-10-09', { region: 'eu' }),
    // A ladder Rankwarden has not enriched: snapshots, but never a classified spec.
    snapshot('2026-10-20', { region: 'tw', classified: 0, specs: [] }),
    // 30 days back: one day before the window.
    recent(30),
    // The window's first day, today being its last.
    recent(29),
    // Counted, not classified: not offered.
    recent(5, { classified: 0, specs: [] }),
    recent(2),
    recent(0),
    // Another cutoff in the window: not this key's.
    recent(3, { minRating: 1500 }),
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/spec-representation', () => {
  it('answers one day’s snapshot, most played spec first', async () => {
    const { status, body } = await representation(`${base}&date=2026-10-20`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'us',
      bracket: '3v3',
      rating: 2100,
      date: '2026-10-20',
      computedAt: '2026-10-20T08:00:00.000Z',
      total: 130,
      classified: 100,
    });
    expect(body.specs.map((s: Json) => `${s.class}-${s.spec}`)).toEqual([
      'warrior-arms',
      'mage-fire',
    ]);
    expect(body.specs[0]).toMatchObject({ count: 70, heroTalents: [{ name: 'Tree' }] });
    expect(body).not.toHaveProperty('availableDates');
  });

  it('lists the days of the last 30 with classified specs for the same key, oldest first', async () => {
    const { status, body } = await representation(
      `${recentBase}&date=latest&returnAvailableDates=true`,
    );

    expect(status).toBe(200);
    expect(body.date).toBe(ago(0));
    expect(body.availableDates).toEqual([ago(29), ago(2), ago(0)]);
  });

  it('lists the same days whichever day is asked for', async () => {
    const { body } = await representation(`${recentBase}&date=${ago(2)}&returnAvailableDates=true`);

    expect(body.availableDates).toEqual([ago(29), ago(2), ago(0)]);
  });

  it('answers 404 for a day without a snapshot', async () => {
    const { status, body } = await representation(
      `${base}&date=2026-10-21&returnAvailableDates=true`,
    );

    expect(status).toBe(404);
    expect(body.message).toBe('No spec representation snapshot for us 3v3 at 2100 on 2026-10-21');
  });

  it('answers the newest snapshot for date=latest, and says which day it is', async () => {
    const { status, body } = await representation(`${base}&date=latest&returnAvailableDates=true`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      date: '2026-10-20',
      computedAt: '2026-10-20T08:00:00.000Z',
      total: 130,
      // Every US 3v3 snapshot is older than the last 30 days.
      availableDates: [],
    });
    expect(body.specs).toHaveLength(2);
  });

  it('answers latest per region, bracket and rating, not across them', async () => {
    // The newest US 3v3 1500 snapshot is the 10th, though 2100 has the 20th.
    const { body } = await representation('region=us&bracket=3v3&rating=1500&date=latest');

    expect(body.date).toBe('2026-10-10');
  });

  it('answers 404 for latest when nothing is stored', async () => {
    const { status, body } = await representation('region=kr&bracket=3v3&rating=2100&date=latest');

    expect(status).toBe(404);
    expect(body.message).toBe('No spec representation snapshot stored for kr 3v3 at 2100');
  });

  it('answers an unclassified snapshot as it is', async () => {
    const { status, body } = await representation('region=tw&bracket=3v3&rating=2100&date=latest');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      date: '2026-10-20',
      classified: 0,
      specs: [],
    });
  });

  it('refuses a rating that is not a tracked cutoff, and a bad date', async () => {
    expect((await representation(`region=us&bracket=3v3&rating=2000&date=2026-10-20`)).status).toBe(
      400,
    );
    expect((await representation(`${base}&date=2026-13-01`)).status).toBe(400);
    expect((await representation(`${base}`)).status).toBe(400);
  });

  it('needs an access token', async () => {
    const response = await fetch(`${app.url}/pvp/spec-representation?${base}&date=2026-10-20`);

    expect(response.status).toBe(401);
  });
});
