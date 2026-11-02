import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PveCatalogue } from '../src/seasons/pve-catalogue.service.js';
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

const OPEN = new Date('2030-01-01T00:00:00Z');

async function raids(): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/raids`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  // Seeded after the boot: the tests wait out the 1 s TTL so the catalogue reads them.
  app = await bootTestApp({
    env: { PVE_CATALOGUE_TTL_SECONDS: '1', RATE_LIMIT_API_PER_MINUTE: '1000' },
  });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertMany([
    {
      id: 1273,
      slug: 'nerubar-palace',
      name: 'Nerub-ar Palace',
      shortName: 'NP',
      icon: 'inv_achievement_raid_nerubarpalace',
      expansionId: 10,
      starts: { us: new Date('2024-09-10T15:00:00Z'), eu: new Date('2024-09-11T04:00:00Z') },
      ends: { us: new Date('2025-02-25T15:00:00Z'), eu: new Date('2025-02-26T04:00:00Z') },
      encounters: [
        { id: 2902, slug: 'ulgrax-the-devourer', name: 'Ulgrax the Devourer' },
        { id: 2922, slug: 'queen-ansurek', name: 'Queen Ansurek' },
      ],
      catalogueUpdatedAt: new Date(),
      // Rankings: never part of the answer.
      guilds: { world: { mythic: [{ rank: 1, guildId: 7 }] } },
    },
    {
      id: 17059,
      slug: 'the-unbinding-of-kithix',
      name: "The Unbinding of Kith'ix",
      shortName: 'UOK',
      icon: '8039569',
      expansionId: 11,
      starts: { us: new Date('2026-10-13T15:00:00Z') },
      ends: { us: OPEN },
      encounters: [{ id: 197189, slug: 'kithix', name: "Kith'ix" }],
      catalogueUpdatedAt: new Date(),
    },
    {
      id: 8638,
      slug: 'the-emerald-nightmare',
      name: 'The Emerald Nightmare',
      shortName: 'EN',
      icon: null,
      expansionId: 6,
      starts: { us: new Date('2016-09-20T15:00:00Z') },
      ends: { us: new Date('2016-11-15T15:00:00Z') },
      encounters: [],
      catalogueUpdatedAt: new Date(),
    },
  ]);

  token = (await anonymousTokens(app)).access_token;
  // Past the 1 s TTL, so the documents inserted after the boot are read.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/raids', () => {
  it('lists every raid, newest first, with its bosses, icon and regional dates', async () => {
    const { status, body } = await raids();

    expect(status).toBe(200);
    expect(body.raids.map((raid: Json) => raid.slug)).toEqual([
      'the-unbinding-of-kithix',
      'nerubar-palace',
      'the-emerald-nightmare',
    ]);
    expect(body.raids[1]).toEqual({
      slug: 'nerubar-palace',
      name: 'Nerub-ar Palace',
      shortName: 'NP',
      expansionId: 10,
      icon: 'inv_achievement_raid_nerubarpalace',
      starts: { us: '2024-09-10T15:00:00.000Z', eu: '2024-09-11T04:00:00.000Z' },
      ends: { us: '2025-02-25T15:00:00.000Z', eu: '2025-02-26T04:00:00.000Z' },
      encounters: [
        { id: 2902, slug: 'ulgrax-the-devourer', name: 'Ulgrax the Devourer' },
        { id: 2922, slug: 'queen-ansurek', name: 'Queen Ansurek' },
      ],
    });
  });

  it('gives a raid still open a null end, and an old one a null icon', async () => {
    const { body } = await raids();

    expect(body.raids[0]).toMatchObject({ icon: '8039569', ends: { us: null } });
    expect(body.raids[2]).toMatchObject({ icon: null, ends: { us: '2016-11-15T15:00:00.000Z' } });
  });

  it('503 when the raids are neither cached nor readable', async () => {
    const spy = vi
      .spyOn(app.app.get(PveCatalogue), 'raids')
      .mockRejectedValueOnce(new Error('connection refused'));

    const { status, body } = await raids();
    spy.mockRestore();

    expect(status).toBe(503);
    expect(body.message).toBe('The raid catalogue is not available');
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/raids`)).status).toBe(401);
  });
});
