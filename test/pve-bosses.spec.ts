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
const encounter = (id: number, slug: string, name: string) => ({ id, slug, name });

/** A board of `count` guilds, ids from `firstGuild`, killed an hour apart. */
const board = (count: number, firstGuild = 1) =>
  Array.from({ length: count }, (_, i) => ({
    guildId: firstGuild + i,
    rank: i + 1,
    itemLevelAvg: 320 - i,
    attempts: i === 0 ? 7 : null,
    firstDefeated: new Date(Date.UTC(2026, 7, 24, i)),
  }));

async function bosses(query = ''): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pve/bosses?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const slugs = (body: Json) => body.bosses.map((boss: Json) => boss.bossSlug);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertMany([
    // The tier's main raid: open, the most bosses.
    {
      id: 16915,
      slug: 'the-venomous-abyss',
      name: 'The Venomous Abyss',
      icon: '8039569',
      expansionId: 11,
      starts: { us: new Date('2026-08-18T15:00:00Z') },
      ends: { us: OPEN },
      encounters: [
        encounter(1, 'nekzali-the-soulcoiler', "Nek'zali the Soulcoiler"),
        encounter(2, 'entombed-sentinels', 'Entombed Sentinels'),
        encounter(3, 'ulatek', "Ula'tek"),
      ],
    },
    // Newer and open, but one boss: not the current raid.
    {
      id: 17059,
      slug: 'the-unbinding-of-kithix',
      name: "The Unbinding of Kith'ix",
      icon: 'inv_1215_raid_achievement_kithix',
      expansionId: 11,
      starts: { us: new Date('2026-10-13T15:00:00Z') },
      ends: { us: OPEN },
      encounters: [encounter(10, 'kithix', "Kith'ix")],
    },
    // Same expansion, more bosses, but closed.
    {
      id: 16000,
      slug: 'tier-mn-1',
      name: 'Tier MN 1',
      icon: null,
      expansionId: 11,
      starts: { us: new Date('2026-03-03T15:00:00Z') },
      ends: { us: new Date('2026-08-11T15:00:00Z') },
      encounters: [
        encounter(20, 'a', 'A'),
        encounter(21, 'b', 'B'),
        encounter(22, 'c', 'C'),
        encounter(23, 'd', 'D'),
      ],
    },
  ]);

  await db.collection('bosses').insertMany([
    // Stored out of the raid's order, to see the raid's order kept.
    {
      id: 3,
      raidId: 16915,
      raidSlug: 'the-venomous-abyss',
      slug: 'ulatek',
      name: "Ula'tek",
      // No mythic kill yet on world: heroic only when asked for alone.
      bossRankings: { world: { mythic: [], heroic: board(2, 100), normal: board(3) } },
    },
    {
      id: 1,
      raidId: 16915,
      raidSlug: 'the-venomous-abyss',
      slug: 'nekzali-the-soulcoiler',
      name: "Nek'zali the Soulcoiler",
      bossRankings: {
        world: { mythic: board(50), heroic: board(50) },
        eu: { mythic: board(5, 2) },
      },
    },
    {
      id: 2,
      raidId: 16915,
      raidSlug: 'the-venomous-abyss',
      slug: 'entombed-sentinels',
      name: 'Entombed Sentinels',
      bossRankings: { world: { mythic: board(4) } },
    },
    // A boss of another raid with a slug from this one: never mixed in.
    {
      id: 99,
      raidId: 16000,
      raidSlug: 'tier-mn-1',
      slug: 'ulatek',
      name: 'Imposter',
      bossRankings: { world: { mythic: board(1, 999) } },
    },
  ]);

  await db.collection('guilds').insertMany(
    Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Guild ${i + 1}`,
      searchName: `guild ${i + 1}`,
      faction: i % 2 ? 'alliance' : 'horde',
      logo: `https://cdn.raiderio.net/${i + 1}.png`,
      region: 'eu',
      realm: { slug: 'tarren-mill', name: 'Tarren Mill' },
      updatedAt: new Date(),
    })),
  );

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pve/bosses', () => {
  it('defaults to the current raid on the world board, in its boss order', async () => {
    const { status, body } = await bosses();

    expect(status).toBe(200);
    expect(body).toMatchObject({ region: 'world', difficulty: 'mythic' });
    expect(slugs(body)).toEqual(['nekzali-the-soulcoiler', 'entombed-sentinels', 'ulatek']);
    expect(body.bosses[0]).toMatchObject({
      bossName: "Nek'zali the Soulcoiler",
      raid: {
        slug: 'the-venomous-abyss',
        name: 'The Venomous Abyss',
        icon: '8039569',
        expansionId: 11,
      },
    });
    expect(body.bosses[0]).not.toHaveProperty('difficulty');
    expect(body.bosses[0].bossRankings).toHaveLength(50);
    expect((await bosses('raidSlug=current')).body).toEqual(body);
  });

  it('gives each ranking its guild', async () => {
    const { body } = await bosses('top=1');

    expect(body.bosses[0].bossRankings).toEqual([
      {
        rank: 1,
        itemLevelAvg: 320,
        attempts: 7,
        firstDefeated: '2026-08-24T00:00:00.000Z',
        guild: {
          id: 1,
          name: 'Guild 1',
          faction: 'horde',
          logo: 'https://cdn.raiderio.net/1.png',
          realm: 'Tarren Mill',
          realmSlug: 'tarren-mill',
          region: 'eu',
        },
      },
    ]);
  });

  it('answers every boss at one difficulty, the hardest any of them has guilds on', async () => {
    const { body } = await bosses();

    // Mythic, as two of the three have mythic kills: Ula'tek's empty mythic board
    // is answered as it is, not with its heroic one.
    expect(body.difficulty).toBe('mythic');
    expect(body.bosses.map((b: Json) => b.bossRankings.length)).toEqual([50, 4, 0]);
  });

  it('falls back to heroic when no boss asked for has a mythic kill', async () => {
    const { body } = await bosses('bossSlug=ulatek');

    expect(body.difficulty).toBe('heroic');
    expect(body.bosses[0].bossRankings.map((r: Json) => r.guild.id)).toEqual([100, 101]);
    // Not stored: every guild field but the id is null.
    expect(body.bosses[0].bossRankings[0].guild).toMatchObject({
      id: 100,
      name: null,
      realm: null,
    });
  });

  it('takes a difficulty asked for, even with nobody on it', async () => {
    const { body } = await bosses('difficulty=normal');

    expect(body.difficulty).toBe('normal');
    expect(body.bosses.map((b: Json) => b.bossRankings.length)).toEqual([0, 0, 3]);
  });

  it('answers a region, a top and one boss', async () => {
    const { body } = await bosses('region=EU&top=2&bossSlug=nekzali-the-soulcoiler');

    expect(body.region).toBe('eu');
    expect(slugs(body)).toEqual(['nekzali-the-soulcoiler']);
    expect(body.bosses[0].bossRankings.map((r: Json) => r.guild.id)).toEqual([2, 3]);
  });

  it('gives a null difficulty and no rankings when no board on the region has guilds', async () => {
    const { body } = await bosses('region=us');

    expect(body.difficulty).toBeNull();
    expect(body.bosses.map((b: Json) => b.bossRankings.length)).toEqual([0, 0, 0]);
  });

  it('reads the named raid, keeping another raid’s boss of the same slug out', async () => {
    const { body } = await bosses('raidSlug=tier-mn-1&bossSlug=a');
    expect(body.difficulty).toBeNull();
    expect(body.bosses[0]).toMatchObject({ bossSlug: 'a', bossRankings: [] });

    const abyss = await bosses('raidSlug=the-venomous-abyss&bossSlug=ulatek');
    expect(abyss.body.bosses[0].bossName).toBe("Ula'tek");
  });

  it('404 for a raid or a boss the raid does not have', async () => {
    const raid = await bosses('raidSlug=nope');
    expect(raid.status).toBe(404);
    expect(raid.body.message).toBe('No raid nope in the catalogue');

    const boss = await bosses('raidSlug=the-unbinding-of-kithix&bossSlug=ulatek');
    expect(boss.status).toBe(404);
    expect(boss.body.message).toBe('No boss ulatek in the-unbinding-of-kithix');
  });

  it('400 for an unknown region or difficulty, or a top out of range', async () => {
    for (const query of ['region=cn', 'difficulty=lfr', 'top=0', 'top=51', 'raidSlug=no%20pe']) {
      expect((await bosses(query)).status, query).toBe(400);
    }
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pve/bosses`)).status).toBe(401);
  });
});
