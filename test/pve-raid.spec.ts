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

const OPEN = new Date('2030-01-01T00:00:00Z');
const READ_AT = new Date('2026-11-03T10:48:02.789Z');

/** A guild on a board: one boss pulled and killed. */
const ranked = (rank: number, guildId: number, regionRank: number | null = rank) => ({
  rank,
  regionRank,
  guildId,
  encountersPulled: [
    {
      encounterId: 1,
      slug: 'nekzali-the-soulcoiler',
      numPulls: 3,
      pullStartedAt: new Date('2026-08-23T23:13:50Z'),
      bestPercent: 0,
      isDefeated: true,
    },
  ],
  encountersDefeated: [
    {
      encounterId: 1,
      slug: 'nekzali-the-soulcoiler',
      firstDefeated: new Date('2026-08-23T23:21:30Z'),
      lastDefeated: new Date('2026-10-30T00:10:30Z'),
    },
  ],
});

async function raid(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/raid?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertMany([
    {
      id: 16915,
      slug: 'the-venomous-abyss',
      name: 'The Venomous Abyss',
      shortName: 'VA',
      icon: '8039569',
      expansionId: 11,
      starts: { us: new Date('2026-08-18T15:00:00Z') },
      ends: { us: OPEN },
      encounters: [
        { id: 1, slug: 'nekzali-the-soulcoiler', name: "Nek'zali the Soulcoiler" },
        { id: 2, slug: 'entombed-sentinels', name: 'Entombed Sentinels' },
      ],
      guilds: {
        // Stored out of order, to see the board sorted.
        world: {
          mythic: [ranked(2, 20, 1), ranked(1, 10, 1), ranked(3, 404, 2)],
          heroic: [ranked(1, 20)],
        },
        eu: { mythic: [ranked(1, 20)] },
      },
      guildsUpdatedAt: { world: { mythic: READ_AT, heroic: READ_AT }, eu: { mythic: READ_AT } },
    },
  ]);

  await db.collection('guilds').insertMany([
    {
      id: 10,
      name: 'Liquid',
      searchName: 'liquid',
      faction: 'horde',
      logo: 'https://cdn.raiderio.net/liquid.png',
      region: 'us',
      realm: { slug: 'illidan', name: 'Illidan' },
      updatedAt: new Date(),
    },
    {
      id: 20,
      name: 'Echo',
      searchName: 'echo',
      faction: 'alliance',
      logo: 'https://cdn.raiderio.net/echo.png',
      region: 'eu',
      realm: { slug: 'tarren-mill', name: 'Tarren Mill' },
      updatedAt: new Date(),
    },
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/raid', () => {
  it('gives the raid and its world mythic board by default, best first', async () => {
    const { status, body } = await raid('raidSlug=the-venomous-abyss');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'world',
      difficulty: 'mythic',
      raid: {
        slug: 'the-venomous-abyss',
        name: 'The Venomous Abyss',
        icon: '8039569',
        encounters: [
          { id: 1, slug: 'nekzali-the-soulcoiler', name: "Nek'zali the Soulcoiler" },
          { id: 2, slug: 'entombed-sentinels', name: 'Entombed Sentinels' },
        ],
      },
      updatedAt: '2026-11-03T10:48:02.789Z',
    });
    expect(body.guilds.map((g: Json) => [g.rank, g.guild.id])).toEqual([
      [1, 10],
      [2, 20],
      [3, 404],
    ]);
  });

  it('keeps every field stored, with the guild in place of its id', async () => {
    const { body } = await raid('raidSlug=the-venomous-abyss');

    expect(body.guilds[0]).toEqual({
      rank: 1,
      regionRank: 1,
      guild: {
        id: 10,
        name: 'Liquid',
        faction: 'horde',
        logo: 'https://cdn.raiderio.net/liquid.png',
        realm: 'Illidan',
        realmSlug: 'illidan',
        region: 'us',
      },
      encountersPulled: [
        {
          encounterId: 1,
          slug: 'nekzali-the-soulcoiler',
          numPulls: 3,
          pullStartedAt: '2026-08-23T23:13:50.000Z',
          bestPercent: 0,
          isDefeated: true,
        },
      ],
      encountersDefeated: [
        {
          encounterId: 1,
          slug: 'nekzali-the-soulcoiler',
          firstDefeated: '2026-08-23T23:21:30.000Z',
          lastDefeated: '2026-10-30T00:10:30.000Z',
        },
      ],
    });
    // A guild Rankwarden has not stored keeps its id, with nulls.
    expect(body.guilds[2].guild).toMatchObject({ id: 404, name: null, logo: null });
  });

  it('answers a region and a difficulty, and current', async () => {
    const eu = await raid('raidSlug=current&region=EU');
    expect(eu.body).toMatchObject({ region: 'eu', difficulty: 'mythic' });
    expect(eu.body.guilds.map((g: Json) => g.guild.name)).toEqual(['Echo']);

    const heroic = await raid('raidSlug=the-venomous-abyss&difficulty=heroic');
    expect(heroic.body.difficulty).toBe('heroic');
    expect(heroic.body.guilds).toHaveLength(1);
  });

  it('gives an empty board and no updatedAt for a board never read', async () => {
    const { status, body } = await raid('raidSlug=the-venomous-abyss&region=kr&difficulty=normal');

    expect(status).toBe(200);
    expect(body).toMatchObject({ region: 'kr', difficulty: 'normal', updatedAt: null, guilds: [] });
  });

  it('404 for a raid the catalogue does not hold', async () => {
    const { status, body } = await raid('raidSlug=nope');

    expect(status).toBe(404);
    expect(body.message).toBe('No raid nope in the catalogue');
  });

  it('400 without a raid, or for an unknown region or difficulty', async () => {
    for (const query of ['region=eu', 'raidSlug=x&region=cn', 'raidSlug=x&difficulty=lfr']) {
      expect((await raid(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/raid?raidSlug=current`)).status).toBe(401);
  });
});
