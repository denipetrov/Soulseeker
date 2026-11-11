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
const yesterday = new Date(today.getTime() - DAY_MS);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const reward = (bracket: string, ratingCutoff: number) => ({
  bracket,
  faction: null,
  ratingCutoff,
  title: `${bracket} title`,
  achievementId: 1,
  specialization: null,
});

const rating = (
  region: string,
  bracket: string,
  characterId: number,
  value: number,
  cls: string,
  spec: string,
) => ({ seasonId: 42, region, bracket, characterId, rating: value, class: cls, spec });

const character = (
  region: string,
  characterId: number,
  name: string,
  ladders: Record<string, number>,
) => ({
  seasonId: 42,
  region,
  characterId,
  characterName: name,
  realmSlug: `${region}-realm`,
  faction: 'HORDE',
  profileStatus: 'ok',
  brackets: Object.fromEntries(
    Object.entries(ladders).map(([bracket, value]) => [
      bracket,
      { rank: 1, rating: value, played: 10, won: 6, lost: 4 },
    ]),
  ),
});

const tree = (id: number, name: string, count: number, share: number) => ({
  id,
  name,
  count,
  share,
});
const share = (cls: string, spec: string, count: number, classified: number, trees: unknown[]) => ({
  class: cls,
  spec,
  count,
  share: count / classified,
  heroTalentsClassified: count,
  heroTalents: trees,
});
const snapshot = (region: string, date: Date, specs: ReturnType<typeof share>[]) => {
  const classified = specs.reduce((sum, entry) => sum + entry.count, 0);
  return {
    date,
    seasonId: 42,
    region,
    family: 'shuffle',
    minRating: 2100,
    total: classified,
    classified,
    specs,
    computedAt: new Date(date.getTime() + (region === 'us' ? 9 : 8) * 3_600_000),
  };
};

async function get(path: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  // One season everywhere, with each region's own cutoffs.
  await db.collection('season_state').insertMany([
    {
      region: 'eu',
      seasonId: 42,
      name: 'Season 42',
      startsAt: new Date('2026-08-18T15:00:00Z'),
      endsAt: null,
      rewardsFetchedAt: new Date('2026-11-05T13:34:09Z'),
      rewards: [
        reward('3v3', 2500),
        reward('shuffle-mage-fire', 2400),
        reward('shuffle-warrior-arms', 2600),
      ],
    },
    {
      region: 'us',
      seasonId: 42,
      name: 'Season 42',
      startsAt: new Date('2026-08-18T15:00:00Z'),
      endsAt: null,
      rewardsFetchedAt: new Date('2026-11-05T13:34:08Z'),
      rewards: [
        reward('3v3', 2400),
        reward('shuffle-mage-fire', 2300),
        reward('shuffle-warrior-arms', 2500),
      ],
    },
  ]);
  await db.collection('archive_seasons').insertMany([
    { region: 'eu', seasonId: 41, name: 'Season 41', rewards: [reward('3v3', 2700)] },
    { region: 'us', seasonId: 41, name: 'Season 41', rewards: [reward('3v3', 2600)] },
  ]);

  await db
    .collection('3v3_ratings')
    .insertMany([
      rating('eu', '3v3', 1, 2600, 'mage', 'fire'),
      rating('us', '3v3', 1, 2550, 'priest', 'discipline'),
      rating('eu', '3v3', 2, 2450, 'warrior', 'arms'),
      rating('us', '3v3', 3, 2350, 'mage', 'fire'),
    ]);
  await db.collection('shuffle_ratings').insertMany([
    rating('eu', 'shuffle-mage-fire', 1, 2450, 'mage', 'fire'),
    rating('us', 'shuffle-mage-fire', 3, 2350, 'mage', 'fire'),
    // Under the US cutoff, 2300.
    rating('us', 'shuffle-mage-fire', 4, 2200, 'mage', 'fire'),
  ]);
  // Character 1 in both regions: two different characters, which the ids alone do not tell apart.
  await db
    .collection('characters')
    .insertMany([
      character('eu', 1, 'EuOne', { '3v3': 2600, 'shuffle-mage-fire': 2450 }),
      character('us', 1, 'UsOne', { '3v3': 2550 }),
      character('eu', 2, 'EuTwo', { '3v3': 2450 }),
      character('us', 3, 'UsThree', { '3v3': 2350, 'shuffle-mage-fire': 2350 }),
    ]);

  const archived = (region: string, characterId: number, value: number) => ({
    seasonId: 41,
    region,
    bracket: '3v3',
    characterId,
    characterName: `${region}${characterId}`,
    realmId: 1,
    realmSlug: `${region}-realm`,
    faction: 'HORDE',
    rank: characterId,
    rating: value,
    played: 50,
    won: 30,
    lost: 20,
  });
  await db
    .collection('archive_entries')
    .insertMany([archived('eu', 11, 2750), archived('us', 12, 2640), archived('eu', 13, 2650)]);

  await db.collection('spec_representation').insertMany([
    snapshot('eu', today, [
      share('priest', 'discipline', 90, 100, [
        tree(18, 'Voidweaver', 60, 0.6667),
        tree(19, 'Oracle', 30, 0.3333),
      ]),
      share('mage', 'fire', 10, 100, []),
    ]),
    snapshot('us', today, [
      share('priest', 'discipline', 5, 20, [tree(19, 'Oracle', 5, 1)]),
      share('mage', 'fire', 15, 20, []),
    ]),
    // Yesterday only Europe had one.
    snapshot('eu', yesterday, [share('mage', 'fire', 40, 40, [])]),
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('region=world on the PvP endpoints', () => {
  describe('/pvp/leaderboard', () => {
    it('merges every region’s ladder by rating, each row judged by its own region', async () => {
      const { status, body } = await get('leaderboard?region=world&seasonId=42&bracket=3v3');

      expect(status).toBe(200);
      expect(body).toMatchObject({ region: 'world', current: true, total: 4, cutoff: null });
      expect(body.regionCutoffs).toMatchObject({ eu: { rating: 2500 }, us: { rating: 2400 } });
      expect(
        body.entries.map((e: Json) => [e.region, e.characterName, e.rating, e.inTitleRange]),
      ).toEqual([
        ['eu', 'EuOne', 2600, true],
        // 2550 reaches the US cutoff, 2400, though not the European one.
        ['us', 'UsOne', 2550, true],
        ['eu', 'EuTwo', 2450, false],
        ['us', 'UsThree', 2350, false],
      ]);
    });

    it('merges an archived season the same way', async () => {
      const { body } = await get('leaderboard?region=world&seasonId=41&bracket=3v3');

      expect(body).toMatchObject({ current: false, total: 3, cutoff: null });
      expect(body.entries.map((e: Json) => [e.region, e.rating, e.inTitleRange])).toEqual([
        ['eu', 2750, true],
        ['eu', 2650, false],
        // 2640 is short of Europe's 2700, but past the US 2600.
        ['us', 2640, true],
      ]);
    });

    it('still answers one region as before, with the region on each entry', async () => {
      const { body } = await get('leaderboard?region=eu&seasonId=42&bracket=3v3');

      expect(body).toMatchObject({ region: 'eu', total: 2, cutoff: { rating: 2500 } });
      expect(body).not.toHaveProperty('regionCutoffs');
      expect(body.entries.every((e: Json) => e.region === 'eu')).toBe(true);
    });
  });

  describe('/pvp/cutoffs', () => {
    it('counts each region against its own cutoff, and adds them up', async () => {
      const { body } = await get('cutoffs?region=world&bracket=3v3');

      expect(body).toMatchObject({
        region: 'world',
        cutoff: null,
        regionCutoffs: { eu: { rating: 2500 }, us: { rating: 2400 } },
        total: 2,
        final: false,
        // The staler of the two regions' reads.
        rewardsFetchedAt: '2026-11-05T13:34:08.000Z',
      });
      expect(body.specs.map((s: Json) => [s.spec, s.count]).sort()).toEqual([
        ['discipline', 1],
        ['fire', 1],
      ]);
    });

    it('gives each spec ladder its regions’ cutoffs', async () => {
      const { body } = await get('cutoffs?region=world&bracket=shuffle');
      const fire = body.specs.find((s: Json) => s.spec === 'fire');

      expect(fire).toMatchObject({
        count: 2,
        regionCutoffs: { eu: { rating: 2400 }, us: { rating: 2300 } },
      });
      expect(fire).not.toHaveProperty('cutoff');
      expect(body.specs.find((s: Json) => s.spec === 'arms').count).toBe(0);
    });

    it('lists every region’s qualifying characters, by rating', async () => {
      const { body } = await get('cutoffs?region=world&bracket=shuffle&class=mage&spec=fire');

      expect(body).toMatchObject({
        cutoff: null,
        regionCutoffs: { eu: { rating: 2400 }, us: { rating: 2300 } },
        total: 2,
      });
      expect(body.characters.map((c: Json) => [c.region, c.characterName, c.rating])).toEqual([
        ['eu', 'EuOne', 2450],
        ['us', 'UsThree', 2350],
      ]);
    });
  });

  describe('/pvp/spec-representation', () => {
    it('adds the regions’ snapshots of the day up, shares worked out again', async () => {
      const { body } = await get(
        'spec-representation?region=world&bracket=shuffle&rating=2100&date=latest&getEarliestDate=true',
      );

      expect(body).toMatchObject({
        region: 'world',
        regions: ['eu', 'us'],
        date: iso(today),
        total: 120,
        classified: 120,
        earliestDate: iso(yesterday),
        // The later of the two regions' computations.
        computedAt: new Date(today.getTime() + 9 * 3_600_000).toISOString(),
      });
      expect(body.specs[0]).toMatchObject({
        spec: 'discipline',
        count: 95,
        share: 0.7917,
        heroTalentsClassified: 95,
        heroTalents: [
          { id: 18, name: 'Voidweaver', count: 60, share: 0.6316 },
          { id: 19, name: 'Oracle', count: 35, share: 0.3684 },
        ],
      });
    });

    it('answers a day only some regions have, from those', async () => {
      const { body } = await get(
        `spec-representation?region=world&bracket=shuffle&rating=2100&date=${iso(yesterday)}`,
      );

      expect(body).toMatchObject({ regions: ['eu'], total: 40 });
    });

    it('combines each day of the history the same way', async () => {
      const { body } = await get(
        'spec-representation/history?region=world&bracket=shuffle&rating=2100',
      );

      expect(body.days.map((d: Json) => [d.date, d.regions, d.total])).toEqual([
        [iso(yesterday), ['eu'], 40],
        [iso(today), ['eu', 'us'], 120],
      ]);
    });
  });

  describe('/pvp/tier-list', () => {
    it('reads every region’s ladder together', async () => {
      const { body } = await get('tier-list?region=world&bracket=3v3');

      expect(body).toMatchObject({ region: 'world', topRows: 4, classified: 4 });
      expect(body.specs.find((s: Json) => s.spec === 'fire').representation.count).toBe(2);
    });
  });
});
