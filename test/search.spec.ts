import { searchNameOf } from '@denipetrov/spirit-link/search';
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

/** A PvP character as Rankwarden stores it, `searchName` folded the way it folds it. */
const pvp = (characterName: string, extra: Record<string, unknown> = {}) => ({
  seasonId: 42,
  region: 'eu',
  characterId: Math.floor(Math.random() * 1e9),
  characterType: 'PvP',
  characterName,
  searchName: searchNameOf(characterName),
  realmId: 1,
  realmSlug: 'kazzak',
  faction: 'HORDE',
  brackets: {},
  ratings: {},
  updatedAt: new Date(),
  profile: {
    realmName: 'Kazzak',
    class: { id: 8, name: 'Mage' },
    spec: { id: 63, name: 'Fire' },
    heroTalentTree: { id: 44, name: 'Sunfury' },
    race: { id: 10, name: 'Blood Elf' },
  },
  ...extra,
});

const mplus = (characterName: string, extra: Record<string, unknown> = {}) => ({
  season: 'season-mn-2',
  region: 'us',
  key: `us/illidan/${characterName.toLowerCase()}`,
  characterName,
  searchName: searchNameOf(characterName),
  realmSlug: 'illidan',
  realmName: 'Illidan',
  faction: 'alliance',
  profile: { className: 'Shaman', specName: 'Elemental', raceName: 'Dwarf' },
  ...extra,
});

const guild = (name: string) => ({
  id: Math.floor(Math.random() * 1e9),
  name,
  searchName: searchNameOf(name),
  region: 'eu',
  realm: { slug: 'blackhand', name: 'Blackhand' },
});

async function suggestions(type: string, q: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(
    `${app.url}/search/suggestions?type=${type}&q=${encodeURIComponent(q)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  return { status: response.status, body: (await response.json()) as Json };
}

const names = (list: { characterName?: string; name?: string }[]) =>
  list.map((entry) => entry.characterName ?? entry.name);

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Rankwarden's indexes, by the names the queries hint.
  await db.collection('characters').createIndex({ searchName: 1 }, { name: 'character_search' });
  await db
    .collection('mplus_characters')
    .createIndex({ searchName: 1 }, { name: 'mplus_character_search' });
  await db.collection('guilds').createIndex({ searchName: 1 }, { name: 'guild_search' });

  await db.collection('season_state').insertMany([
    { region: 'eu', seasonId: 42 },
    { region: 'us', seasonId: 42 },
  ]);
  await db.collection('mplus_season_state').insertMany([
    { region: 'us', season: 'season-mn-2' },
    { region: 'eu', season: 'season-mn-2' },
  ]);

  await db.collection('characters').insertMany([
    pvp('Biba'),
    pvp('Bìbà'),
    pvp('BIBAZAVR'),
    pvp('Bob'),
    // An old season's copy: never suggested.
    pvp('Bibaold', { seasonId: 41 }),
    // Not enriched yet: no profile at all.
    { ...pvp('Bibanew'), profile: undefined },
    ...Array.from({ length: 120 }, (_, i) => pvp(`Many${String(i).padStart(3, '0')}`)),
  ]);
  await db
    .collection('mplus_characters')
    .insertMany([mplus('Bibà'), mplus('Bibastruja'), mplus('Bibaprev', { season: 'season-mn-1' })]);
  await db.collection('guilds').insertMany([guild('Bíbà Club'), guild('Other Guild')]);

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

describe('GET /search/suggestions', () => {
  it('finds PvP characters whatever their accents and case', async () => {
    const { status, body } = await suggestions('PvP', 'biba');

    expect(status).toBe(200);
    expect(body.query).toBe('biba');
    expect(names(body.characters).sort()).toEqual(['BIBAZAVR', 'Biba', 'Bibanew', 'Bìbà'].sort());
    expect(body.guilds).toEqual([]);
  });

  it('folds the query too: an accented search finds the plain name', async () => {
    const { body } = await suggestions('pvp', 'BÍB');

    expect(names(body.characters)).toEqual(expect.arrayContaining(['Biba', 'Bìbà']));
  });

  it('returns the fields the front end shows, nulls where not known yet', async () => {
    const { body } = await suggestions('pvp', 'bibaz');

    expect(body.characters).toEqual([
      {
        characterName: 'BIBAZAVR',
        region: 'eu',
        realmSlug: 'kazzak',
        realmName: 'Kazzak',
        className: 'Mage',
        specName: 'Fire',
        heroTalents: 'Sunfury',
        raceName: 'Blood Elf',
        faction: 'horde',
      },
    ]);

    const fresh = (await suggestions('pvp', 'bibanew')).body.characters[0];
    expect(fresh).toMatchObject({ characterName: 'Bibanew', className: null, heroTalents: null });
  });

  it('returns at most 100 characters', async () => {
    const { body } = await suggestions('pvp', 'many');

    expect(body.characters).toHaveLength(100);
  });

  it('searches Mythic+ characters of the current season and guilds for PvE', async () => {
    const { status, body } = await suggestions('PvE', 'biba');

    expect(status).toBe(200);
    expect(names(body.characters)).toEqual(['Bibà', 'Bibastruja']);
    expect(body.characters[0]).toMatchObject({ heroTalents: null, faction: 'alliance' });
    expect(body.guilds).toEqual([
      { name: 'Bíbà Club', region: 'eu', realmSlug: 'blackhand', realmName: 'Blackhand' },
    ]);
  });

  it('treats regex characters in the query literally', async () => {
    const { status, body } = await suggestions('pvp', 'b.*');

    expect(status).toBe(200);
    expect(body.characters).toEqual([]);
  });

  it('refuses a bad type or a too-short query', async () => {
    expect((await suggestions('raid', 'biba')).status).toBe(400);
    expect((await suggestions('pvp', 'b')).status).toBe(400);
  });

  it('needs an access token', async () => {
    const response = await fetch(`${app.url}/search/suggestions?type=pvp&q=biba`);

    expect(response.status).toBe(401);
  });
});
