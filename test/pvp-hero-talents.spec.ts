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

const SLAYER = { id: 60, name: 'Slayer' };
const COLOSSUS = { id: 62, name: 'Colossus' };
const MOUNTAIN = { id: 63, name: 'Mountain Thane' };

const row = (
  region: string,
  bracket: string,
  characterId: number,
  rating: number,
  spec = 'arms',
) => ({
  seasonId: 42,
  region,
  bracket,
  characterId,
  rating,
  class: 'warrior',
  spec,
});

/** A warrior whose active spec plays `active`, with an Arms and a Fury loadout. */
const character = (
  region: string,
  characterId: number,
  active: typeof SLAYER,
  arms: typeof SLAYER,
  fury = MOUNTAIN,
) => ({
  seasonId: 42,
  region,
  characterId,
  characterName: `W${characterId}`,
  profile: {
    heroTalentTree: active,
    talentLoadouts: [
      { spec: { id: 71, name: 'Arms' }, heroTalentTree: arms },
      { spec: { id: 72, name: 'Fury' }, heroTalentTree: fury },
    ],
  },
});

async function heroTalents(query: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${app.url}/pvp/hero-talents?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as Json };
}

const specOf = (body: Json, cls: string, spec: string) =>
  body.classes.find((c: Json) => c.class === cls).specs.find((s: Json) => s.spec === spec);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  await resetRedis(app);
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('season_state').insertMany(
    ['eu', 'us'].map((region) => ({
      region,
      seasonId: 42,
      name: 'Season 42',
      startsAt: new Date('2026-08-18T15:00:00Z'),
      endsAt: null,
    })),
  );

  await db.collection('3v3_ratings').insertMany([
    row('eu', '3v3', 1, 2900),
    row('eu', '3v3', 2, 2700),
    // Not enriched yet: no character document.
    row('eu', '3v3', 3, 2600),
    // The same id in another region: another character.
    row('us', '3v3', 1, 2800),
    row('us', '3v3', 4, 2500),
  ]);
  await db
    .collection('shuffle_ratings')
    .insertMany([
      row('eu', 'shuffle-warrior-arms', 1, 3100),
      row('eu', 'shuffle-warrior-fury', 2, 3000, 'fury'),
    ]);

  await db.collection('characters').insertMany([
    // Plays Mountain Thane as Fury (active), Slayer on Arms.
    character('eu', 1, MOUNTAIN, SLAYER),
    character('eu', 2, SLAYER, SLAYER),
    character('us', 1, COLOSSUS, COLOSSUS),
    character('us', 4, SLAYER, SLAYER),
  ]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /pvp/hero-talents', () => {
  it('lists every class and spec, each with its top characters’ trees', async () => {
    const { status, body } = await heroTalents('region=eu&bracket=3v3');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      region: 'eu',
      bracket: '3v3',
      seasonId: 42,
      seasonName: 'Season 42',
      top: 50,
    });
    expect(body.classes).toHaveLength(13);
    expect(body.classes.flatMap((c: Json) => c.specs)).toHaveLength(40);
    expect(specOf(body, 'warrior', 'arms')).toEqual({
      spec: 'arms',
      characters: 3,
      // Character 3 has no profile yet.
      covered: 2,
      minRating: 2600,
      maxRating: 2900,
      // On 3v3, the active spec's tree.
      heroTalents: [
        { id: 60, name: 'Slayer', count: 1, share: 0.5 },
        { id: 63, name: 'Mountain Thane', count: 1, share: 0.5 },
      ],
    });
    expect(specOf(body, 'mage', 'fire')).toEqual({
      spec: 'fire',
      characters: 0,
      covered: 0,
      minRating: null,
      maxRating: null,
      heroTalents: [],
    });
  });

  it('reads the ladder spec’s own loadout on Shuffle', async () => {
    const { body } = await heroTalents('region=eu&bracket=shuffle');

    // Character 1 plays Mountain Thane as Fury, but Slayer on its Arms ladder.
    expect(specOf(body, 'warrior', 'arms').heroTalents).toEqual([
      { id: 60, name: 'Slayer', count: 1, share: 1 },
    ]);
    expect(specOf(body, 'warrior', 'fury').heroTalents).toEqual([
      { id: 63, name: 'Mountain Thane', count: 1, share: 1 },
    ]);
  });

  it('takes only the top characters asked for', async () => {
    const arms = specOf((await heroTalents('region=eu&bracket=3v3&top=1')).body, 'warrior', 'arms');

    expect(arms).toMatchObject({ characters: 1, covered: 1, minRating: 2900, maxRating: 2900 });
  });

  it('reads every region together on world, each character from its own region', async () => {
    const arms = specOf(
      (await heroTalents('region=world&bracket=3v3&top=4')).body,
      'warrior',
      'arms',
    );

    // EU 2900, US 2800, EU 2700, EU 2600: US 2500 is past the top 4.
    expect(arms).toMatchObject({ characters: 4, covered: 3, minRating: 2600, maxRating: 2900 });
    // US character 1 is not EU character 1: Colossus, not Mountain Thane.
    expect(arms.heroTalents.map((h: Json) => [h.name, h.count])).toEqual([
      ['Slayer', 1],
      ['Colossus', 1],
      ['Mountain Thane', 1],
    ]);
  });

  it('400 for a top out of range, or an unknown bracket or region', async () => {
    for (const query of [
      'region=eu&bracket=3v3&top=0',
      'region=eu&bracket=3v3&top=501',
      'region=eu&bracket=5v5',
      'region=xx&bracket=3v3',
      'bracket=3v3',
    ]) {
      expect((await heroTalents(query)).status, query).toBe(400);
    }
  });

  it('404 without a current season', async () => {
    expect((await heroTalents('region=kr&bracket=3v3')).status).toBe(404);
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/pvp/hero-talents?region=eu&bracket=3v3`)).status).toBe(401);
  });
});
