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

const reward = (bracket: string, ratingCutoff: number, extra: Record<string, unknown> = {}) => ({
  bracket,
  faction: null,
  ratingCutoff,
  title: `${bracket} title`,
  achievementId: 1,
  specialization: null,
  ...extra,
});

const row = (bracket: string, rating: number, cls: string | null, spec: string | null) => ({
  seasonId: 42,
  region: 'eu',
  bracket,
  characterId: Math.floor(Math.random() * 1e9),
  rating,
  class: cls,
  spec,
});

async function cutoffs(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/cutoffs?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('season_state').insertMany([
    {
      region: 'eu',
      seasonId: 42,
      name: 'Player vs. Player (Midnight Season 2)',
      startsAt: new Date('2026-08-18T15:00:00Z'),
      endsAt: null,
      rewardsFetchedAt: new Date('2026-10-19T09:46:33Z'),
      rewards: [
        reward('3v3', 2500, { title: 'Venomous Gladiator' }),
        reward('rbg', 2400, { faction: 'ALLIANCE', title: 'Hero of the Alliance' }),
        reward('rbg', 2400, { faction: 'HORDE', title: 'Hero of the Horde' }),
        reward('shuffle-mage-fire', 2400, { specialization: { id: 63, name: 'Fire' } }),
        reward('shuffle-warrior-arms', 2600, { specialization: { id: 71, name: 'Arms' } }),
        reward('shuffle-priest-holy', 2200, { specialization: { id: 257, name: 'Holy' } }),
      ],
    },
    // A season Rankwarden has not read cutoffs for yet.
    { region: 'us', seasonId: 42, name: 'Season 42', startsAt: new Date(), endsAt: null },
  ]);

  await db.collection('3v3_ratings').insertMany([
    { ...row('3v3', 2700, 'mage', 'fire'), characterId: 201 },
    { ...row('3v3', 2500, 'mage', 'fire'), characterId: 202 }, // exactly at the cutoff: counts
    row('3v3', 2600, 'warrior', 'arms'),
    row('3v3', 2550, null, null), // not enriched yet
    row('3v3', 2499, 'mage', 'frost'), // one short
    { ...row('3v3', 3000, 'mage', 'fire'), seasonId: 41 }, // another season
    { ...row('3v3', 3000, 'mage', 'fire'), region: 'kr' }, // another region
  ]);
  await db.collection('rbg_ratings').insertMany([row('rbg', 2450, 'druid', 'balance')]);
  await db.collection('shuffle_ratings').insertMany([
    { ...row('shuffle-mage-fire', 2450, 'mage', 'fire'), characterId: 201 },
    // No character document: Rankwarden has not got to it, so its fields are null.
    { ...row('shuffle-mage-fire', 2400, 'mage', 'fire'), characterId: 101 },
    row('shuffle-mage-fire', 2399, 'mage', 'fire'),
    // 2500 is past fire's cutoff but short of arms' own 2600.
    row('shuffle-warrior-arms', 2500, 'warrior', 'arms'),
    row('shuffle-warrior-arms', 2650, 'warrior', 'arms'),
  ]);

  await db.collection('characters').insertOne({
    seasonId: 42,
    region: 'eu',
    characterId: 201,
    characterName: 'Biba',
    realmSlug: 'kazzak',
    faction: 'HORDE',
    profileStatus: 'ok',
    brackets: {
      '3v3': { rank: 1, rating: 2700, played: 10, won: 7, lost: 3 },
      'shuffle-mage-fire': {
        rank: 1,
        rating: 2450,
        previousRating: 2430,
        played: 60,
        won: 40,
        lost: 20,
      },
    },
    profile: {
      class: { id: 8, name: 'Mage' },
      spec: { id: 63, name: 'Fire' },
      heroTalentTree: { id: 44, name: 'Sunfury' },
      talentLoadouts: [
        { spec: { id: 63, name: 'Fire' }, heroTalentTree: { id: 44, name: 'Sunfury' } },
      ],
      gender: 'FEMALE',
      level: 90,
      race: { id: 10, name: 'Blood Elf' },
    },
  });

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/cutoffs', () => {
  it('counts 3v3 per spec at or above the one cutoff, with the season and title', async () => {
    const { status, body } = await cutoffs('region=eu&bracket=3v3');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'eu',
      bracket: '3v3',
      seasonId: 42,
      seasonName: 'Player vs. Player (Midnight Season 2)',
      final: false,
      rewardsFetchedAt: '2026-10-19T09:46:33.000Z',
      cutoff: { rating: 2500, title: 'Venomous Gladiator' },
      total: 4,
    });
    expect(body.specs).toEqual([
      { class: 'mage', spec: 'fire', count: 2 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
    // Characters not enriched yet are counted, under a null class and spec.
    expect(body.specs).toContainEqual({ class: null, spec: null, count: 1 });
  });

  it('gives RBG its faction titles, one rating for both', async () => {
    const { body } = await cutoffs('region=eu&bracket=rbg');

    expect(body.cutoff).toMatchObject({
      rating: 2400,
      factions: {
        alliance: { title: 'Hero of the Alliance' },
        horde: { title: 'Hero of the Horde' },
      },
    });
    expect(body).toMatchObject({
      total: 1,
      specs: [{ class: 'druid', spec: 'balance', count: 1 }],
    });
  });

  it('counts Shuffle per spec, each against its own cutoff, a spec without anyone at 0', async () => {
    const { status, body } = await cutoffs('region=eu&bracket=shuffle');

    expect(status).toBe(200);
    expect(body).toMatchObject({ cutoff: null, total: 3 });
    expect(body.specs).toEqual([
      {
        class: 'mage',
        spec: 'fire',
        count: 2,
        cutoff: expect.objectContaining({
          bracket: 'shuffle-mage-fire',
          rating: 2400,
          title: 'shuffle-mage-fire title',
        }),
      },
      expect.objectContaining({ class: 'warrior', spec: 'arms', count: 1 }),
      expect.objectContaining({ class: 'priest', spec: 'holy', count: 0 }),
    ]);
  });

  it('404 when the region has no cutoffs recorded yet', async () => {
    const { status, body } = await cutoffs('region=us&bracket=shuffle');

    expect(status).toBe(404);
    expect(body.message).toContain('No shuffle title cutoffs recorded yet');
  });

  it('404 when the region has no current season, and for Blitz without cutoffs', async () => {
    expect((await cutoffs('region=tw&bracket=3v3')).status).toBe(404);
    expect((await cutoffs('region=eu&bracket=blitz')).status).toBe(404);
  });

  it('400 for 2v2, which awards no title, and for an unknown region', async () => {
    expect((await cutoffs('region=eu&bracket=2v2')).status).toBe(400);
    expect((await cutoffs('region=cn&bracket=3v3')).status).toBe(400);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pvp/cutoffs?region=eu&bracket=3v3`)).status).toBe(401);
  });
});

describe('GET /pvp/cutoffs with class and spec', () => {
  it("lists the spec's characters who reach its own cutoff, best first, as leaderboard entries", async () => {
    const { status, body } = await cutoffs('region=eu&bracket=shuffle&class=mage&spec=fire');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'eu',
      bracket: 'shuffle',
      class: 'mage',
      spec: 'fire',
      seasonId: 42,
      final: false,
      cutoff: { bracket: 'shuffle-mage-fire', rating: 2400, title: 'shuffle-mage-fire title' },
      total: 2,
    });
    expect(body).not.toHaveProperty('specs');
    // 2399 is one short of the 2400 cutoff and is left out.
    expect(body.characters.map((e: Json) => e.rating)).toEqual([2450, 2400]);
    expect(body.characters[1]).toMatchObject({ characterId: 101, characterName: null, rank: null });
  });

  it('gives each character exactly the entry the leaderboard gives it', async () => {
    const listed = (await cutoffs('region=eu&bracket=shuffle&class=mage&spec=fire')).body
      .characters[0];
    const board = (await (
      await fetch(
        `${app.url}/pvp/leaderboard?region=eu&seasonId=42&bracket=shuffle&class=mage&spec=fire`,
        { headers: { authorization: `Bearer ${token}` } },
      )
    ).json()) as Json;

    expect(listed).toEqual(board.entries[0]);
    expect(listed).toEqual({
      characterId: 201,
      characterName: 'Biba',
      realmSlug: 'kazzak',
      bracket: 'shuffle-mage-fire',
      rating: 2450,
      rank: 1,
      played: 60,
      won: 40,
      lost: 20,
      faction: 'horde',
      inTitleRange: true,
      previousRating: 2430,
      class: 'mage',
      spec: 'fire',
      gender: 'female',
      heroTalents: 'Sunfury',
      level: 90,
      profileStatus: 'ok',
      race: 'Blood Elf',
    });
  });

  it('lists 3v3 characters of that active spec against the one season cutoff', async () => {
    const { body } = await cutoffs('region=eu&bracket=3v3&class=mage&spec=fire');

    expect(body).toMatchObject({ cutoff: { rating: 2500 }, total: 2 });
    expect(body.characters.map((e: Json) => [e.characterId, e.rating])).toEqual([
      [201, 2700],
      [202, 2500],
    ]);
    expect(body.characters[0]).toMatchObject({ characterName: 'Biba', played: 10 });
  });

  it('answers an empty list for a real spec nobody of reaches', async () => {
    const { status, body } = await cutoffs('region=eu&bracket=shuffle&class=priest&spec=holy');

    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 0, characters: [] });
  });

  it('404 for a spec the season has no cutoff for, or one that does not exist', async () => {
    expect((await cutoffs('region=eu&bracket=shuffle&class=paladin&spec=fire')).status).toBe(404);
    expect((await cutoffs('region=eu&bracket=3v3&class=mage&spec=bogus')).status).toBe(404);
  });

  it('400 for a class without a spec, or a spec without a class', async () => {
    expect((await cutoffs('region=eu&bracket=shuffle&class=mage')).status).toBe(400);
    expect((await cutoffs('region=eu&bracket=shuffle&spec=fire')).status).toBe(400);
  });
});
