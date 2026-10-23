import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PveCatalogue } from '../src/seasons/pve-catalogue.service.js';
import { bootTestApp, resetRedis, type TestApp } from './support/app.js';
import { openTestDatabase } from './support/database.js';

let app: TestApp;
let db: Db;
let drop: () => Promise<void>;

const encounter = (id: number, slug: string, name: string) => ({ id, slug, name });

beforeAll(async () => {
  // Seeded after the boot: the tests wait out the 1 s TTL so the catalogue reads them.
  app = await bootTestApp({ env: { PVE_CATALOGUE_TTL_SECONDS: '1' } });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertMany([
    {
      id: 1273,
      slug: 'nerubar-palace',
      name: 'Nerub-ar Palace',
      shortName: 'NP',
      expansionId: 10,
      starts: { us: new Date('2024-09-10T15:00:00Z'), eu: new Date('2024-09-11T07:00:00Z') },
      encounters: [
        { ...encounter(2902, 'ulgrax-the-devourer', 'Ulgrax the Devourer'), extra: true },
        encounter(2922, 'queen-ansurek', 'Queen Ansurek'),
      ],
      guilds: { world: { mythic: [{ rank: 1, guildId: 7 }] } },
    },
    {
      id: 1296,
      slug: 'liberation-of-undermine',
      name: 'Liberation of Undermine',
      expansionId: 10,
      starts: { us: new Date('2025-03-04T15:00:00Z') },
      encounters: [encounter(3009, 'vexie-and-the-geargrinders', 'Vexie and the Geargrinders')],
    },
    {
      id: 1200,
      slug: 'aberrus-the-shadowed-crucible',
      name: 'Aberrus, the Shadowed Crucible',
      expansionId: 9,
      starts: { us: new Date('2023-05-09T15:00:00Z') },
      encounters: [],
    },
  ]);

  await db.collection('mplus_seasons').insertMany([
    {
      slug: 'season-tww-1',
      name: 'TWW Season 1',
      expansionId: 10,
      starts: { us: new Date('2024-09-17T15:00:00Z') },
      dungeonIds: [9527, 14938],
      // As Rankwarden stores them: only the quantiles' overall minimum score is kept.
      cutoffs: {
        us: {
          status: 'ok',
          keystones: { keystoneHero: { score: 2500 } },
          quantiles: {
            p999: { score: null, all: { quantile: 0.999, minScore: 3487.2 }, horde: {} },
            p990: { score: null, all: { quantile: 0.99, minScore: 2950 } },
          },
        },
        eu: { status: 'missing' },
      },
    },
    {
      slug: 'season-mn-2',
      name: 'MN Season 2',
      expansionId: 11,
      starts: { us: new Date('2026-08-18T15:00:00Z') },
      dungeonIds: [1, 2, 3],
      archive: { status: 'incomplete' },
    },
  ]);
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('PveCatalogue', () => {
  it('holds slugs, names, bosses and dungeon ids, newest first, and nothing else', async () => {
    const catalogue = app.app.get(PveCatalogue);
    // Past the 1 s TTL, so the documents inserted after the boot are read.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const { raids, mplusSeasons } = await catalogue.catalogue();

    expect(raids).toEqual([
      {
        slug: 'liberation-of-undermine',
        name: 'Liberation of Undermine',
        expansionId: 10,
        encounters: [encounter(3009, 'vexie-and-the-geargrinders', 'Vexie and the Geargrinders')],
      },
      {
        slug: 'nerubar-palace',
        name: 'Nerub-ar Palace',
        expansionId: 10,
        encounters: [
          encounter(2902, 'ulgrax-the-devourer', 'Ulgrax the Devourer'),
          encounter(2922, 'queen-ansurek', 'Queen Ansurek'),
        ],
      },
      {
        slug: 'aberrus-the-shadowed-crucible',
        name: 'Aberrus, the Shadowed Crucible',
        expansionId: 9,
        encounters: [],
      },
    ]);
    expect(mplusSeasons).toEqual([
      {
        slug: 'season-mn-2',
        name: 'MN Season 2',
        dungeonIds: [1, 2, 3],
        expansionId: 11,
        cutoffs: {},
      },
      {
        slug: 'season-tww-1',
        name: 'TWW Season 1',
        dungeonIds: [9527, 14938],
        expansionId: 10,
        cutoffs: { us: { p999: 3487.2, p990: 2950 }, eu: { p999: null, p990: null } },
      },
    ]);
    expect((await catalogue.currentExpansionRaids()).map((raid) => raid.slug)).toEqual([
      'liberation-of-undermine',
      'nerubar-palace',
    ]);
    expect(await catalogue.raidSlugs()).toEqual([
      'liberation-of-undermine',
      'nerubar-palace',
      'aberrus-the-shadowed-crucible',
    ]);
    expect(await catalogue.mplusSeason('season-tww-1')).toMatchObject({
      dungeonIds: [9527, 14938],
    });
    expect(await catalogue.raid('no-such-raid')).toBeNull();
  });

  it('answers from memory within the TTL and reads again after it', async () => {
    const catalogue = app.app.get(PveCatalogue);
    const first = await catalogue.catalogue();

    await db.collection('mplus_seasons').insertOne({
      slug: 'season-mn-3',
      name: 'MN Season 3',
      expansionId: 11,
      starts: { us: new Date('2027-01-12T15:00:00Z') },
      dungeonIds: [4],
    });

    expect(await catalogue.catalogue()).toBe(first);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await catalogue.mplusSeasonSlugs()).toEqual([
      'season-mn-3',
      'season-mn-2',
      'season-tww-1',
    ]);
  });
});
