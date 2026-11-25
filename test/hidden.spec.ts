import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

const ADMIN_KEY = 'test-admin-key-0123456789abcdef0123456789';
const LIVE = 'season-mn-2';

/** `Hîdey` on Kazzak, in both games, and a visible `Shown`; guild 77 hidden, 78 not. */
const HIDDEN = { region: 'eu', realmSlug: 'kazzak', name: 'Hîdey' };

const api = async (path: string): Promise<{ status: number; body: Json }> => {
  const response = await fetch(`${app.url}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as Json };
};

const admin = (body: unknown, key: string | null = ADMIN_KEY) =>
  fetch(`${app.url}/admin/hidden`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: JSON.stringify(body),
  });

const member = (id: number, name: string) => ({
  rioCharacterId: id,
  characterName: name,
  realmSlug: 'kazzak',
  realmId: 1,
  region: 'eu',
  classId: 8,
  className: 'Mage',
  specId: 62,
  specName: 'Arcane',
  role: 'dps',
  faction: 'horde',
  anonymized: false,
});

const mplusCharacter = (name: string, score: number) => ({
  season: LIVE,
  region: 'eu',
  key: `eu/kazzak/${name.normalize('NFC').toLowerCase()}`,
  realmSlug: 'kazzak',
  realmName: 'Kazzak',
  nameKey: name.toLowerCase(),
  characterName: name,
  searchName: name === 'Hîdey' ? 'hidey' : 'shown',
  faction: 'horde',
  profile: { classId: 8, className: 'Mage', specId: 62, specName: 'Arcane', role: 'dps' },
  mythicScore: score,
  isFullyCovered: true,
  dungeonRuns: [],
});

const rankedGuild = (rank: number, guildId: number) => ({
  rank,
  regionRank: rank,
  guildId,
  encountersPulled: [],
  encountersDefeated: [],
});

beforeAll(async () => {
  app = await bootTestApp({
    env: {
      ADMIN_API_KEY: ADMIN_KEY,
      RATE_LIMIT_API_PER_MINUTE: '1000',
      BLIZZARD_RETRY_LIMIT: '0',
      RAIDERIO_RETRY_LIMIT: '0',
    },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  // Rankwarden's indexes these reads name in a hint.
  await db.collection('characters').createIndex({ searchName: 1 }, { name: 'character_search' });
  await db.collection('guilds').createIndex({ searchName: 1 }, { name: 'guild_search' });
  await db.collection('mplus_characters').createIndexes([
    { key: { searchName: 1 }, name: 'mplus_character_search' },
    { key: { season: 1, region: 1, mythicScore: -1 }, name: 'mplus_score_board' },
  ]);
  await db
    .collection('mplus_runs')
    .createIndex({ season: 1, region: 1, score: -1 }, { name: 'run_board' });

  await db.collection('season_state').insertOne({
    region: 'eu',
    seasonId: 42,
    name: 'Season 42',
    startsAt: new Date('2026-08-18T15:00:00Z'),
    endsAt: null,
    rewards: [
      {
        bracket: '3v3',
        faction: null,
        ratingCutoff: 2400,
        title: 'Gladiator',
        achievementId: 1,
        specialization: null,
      },
    ],
  });
  await db.collection('characters').insertMany([
    {
      seasonId: 42,
      region: 'eu',
      characterId: 1,
      characterName: 'Hîdey',
      realmSlug: 'kazzak',
      searchName: 'hidey',
      faction: 'HORDE',
      brackets: {},
    },
    {
      seasonId: 42,
      region: 'eu',
      characterId: 2,
      characterName: 'Shown',
      realmSlug: 'kazzak',
      searchName: 'shown',
      faction: 'HORDE',
      brackets: {},
    },
  ]);
  await db.collection('3v3_ratings').insertMany([
    {
      seasonId: 42,
      region: 'eu',
      bracket: '3v3',
      characterId: 1,
      rating: 2600,
      class: 'mage',
      spec: 'fire',
    },
    {
      seasonId: 42,
      region: 'eu',
      bracket: '3v3',
      characterId: 2,
      rating: 2500,
      class: 'mage',
      spec: 'fire',
    },
  ]);

  await db.collection('mplus_seasons').insertOne({
    slug: LIVE,
    name: 'MN Season 2',
    expansionId: 11,
    starts: { eu: new Date('2026-08-18') },
  });
  await db
    .collection('mplus_season_state')
    .insertMany(
      ['us', 'eu', 'kr', 'tw', 'cn'].map((region) => ({ region, season: LIVE, ended: false })),
    );
  await db
    .collection('mplus_characters')
    .insertMany([mplusCharacter('Hîdey', 4000), mplusCharacter('Shown', 3900)]);
  await db.collection('mplus_runs').insertOne({
    season: LIVE,
    region: 'eu',
    keystoneRunId: 5,
    score: 500,
    dungeon: { id: 1, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
    mythicLevel: 20,
    clearTimeMs: 1_800_000,
    keystoneTimeMs: 2_040_000,
    timeRemainingMs: 240_000,
    numChests: 1,
    completedAt: new Date('2026-10-09T00:24:13Z'),
    affixIds: [9],
    faction: 'horde',
    roster: [member(11, 'HÎDEY'), member(12, 'Shown')],
  });

  await db.collection('guilds').insertMany([
    {
      id: 77,
      name: 'Hidden Guild',
      searchName: 'hidden guild',
      region: 'eu',
      realm: { slug: 'kazzak', name: 'Kazzak' },
      faction: 'horde',
      logo: null,
    },
    {
      id: 78,
      name: 'Hidden Guild Two',
      searchName: 'hidden guild two',
      region: 'eu',
      realm: { slug: 'kazzak', name: 'Kazzak' },
      faction: 'horde',
      logo: null,
    },
  ]);
  await db.collection('raids').insertOne({
    id: 1,
    slug: 'sporefall',
    name: 'Sporefall',
    shortName: 'SF',
    icon: null,
    expansionId: 11,
    starts: { eu: new Date('2026-10-13T15:00:00Z') },
    ends: {},
    encounters: [{ id: 1, slug: 'rotmire', name: 'Rotmire' }],
    guilds: { world: { mythic: [rankedGuild(1, 77), rankedGuild(2, 78)] } },
    guildsUpdatedAt: { world: { mythic: new Date() } },
  });

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

beforeEach(async () => {
  await db.collection('hidden_entries').deleteMany({});
  await resetRedis(app);
  app.upstream.reset();
  // A fake Rankwarden: records the list as the real one does, and answers likewise.
  app.upstream.route(async (request) => {
    if (request.path !== '/rankwarden/hidden') return undefined;
    const body = request.body as Json;
    const key =
      body.kind === 'guild'
        ? String(body.guildId)
        : `${body.region}/${String(body.realmSlug).toLowerCase()}/${String(body.name).normalize('NFC').toLowerCase()}`;
    if (body.hidden) {
      await db
        .collection('hidden_entries')
        .updateOne(
          { kind: body.kind, key },
          { $setOnInsert: { hiddenAt: new Date() } },
          { upsert: true },
        );
    } else {
      await db.collection('hidden_entries').deleteOne({ kind: body.kind, key });
    }
    return {
      status: 200,
      body: {
        ...body,
        updated: body.kind === 'guild' ? { guilds: 1 } : { characters: 1, mplusCharacters: 1 },
      },
    };
  });
  token = (await anonymousTokens(app)).access_token;
});

const hideAll = async () => {
  expect((await admin({ kind: 'character', ...HIDDEN, hidden: true })).status).toBe(200);
  expect((await admin({ kind: 'guild', guildId: 77, hidden: true })).status).toBe(200);
};

describe('POST /admin/hidden', () => {
  it('refuses a missing or wrong admin key, and needs no visitor token', async () => {
    expect((await admin({ kind: 'guild', guildId: 77, hidden: true }, null)).status).toBe(401);
    expect((await admin({ kind: 'guild', guildId: 77, hidden: true }, 'wrong')).status).toBe(401);
    expect(app.upstream.requestsTo('/rankwarden')).toHaveLength(0);
  });

  it("hands a player to Rankwarden's POST /hidden and answers what it answered", async () => {
    const response = await admin({ kind: 'character', ...HIDDEN, hidden: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: 'character',
      ...HIDDEN,
      hidden: true,
      updated: { characters: 1, mplusCharacters: 1 },
    });
    expect(app.upstream.requestsTo('/rankwarden/hidden')[0]?.body).toEqual({
      kind: 'character',
      ...HIDDEN,
      hidden: true,
    });
  });

  it("finds a guild's id by realm and name, and 404s one Rankwarden does not store", async () => {
    const byName = await admin({
      kind: 'guild',
      region: 'eu',
      realmSlug: 'kazzak',
      name: 'hidden guild',
      hidden: true,
    });
    expect(byName.status).toBe(200);
    expect(app.upstream.requestsTo('/rankwarden/hidden')[0]?.body).toEqual({
      kind: 'guild',
      guildId: 77,
      hidden: true,
    });

    const unknown = await admin({
      kind: 'guild',
      region: 'eu',
      realmSlug: 'kazzak',
      name: 'Nobody',
      hidden: true,
    });
    expect(unknown.status).toBe(404);
  });

  it('400s an invalid body; 502s when Rankwarden fails, changing nothing', async () => {
    expect((await admin({ kind: 'guild', hidden: true })).status).toBe(400);
    expect(
      (await admin({ kind: 'character', region: 'xx', realmSlug: 'k', name: 'n', hidden: true }))
        .status,
    ).toBe(400);

    app.upstream.route((request) =>
      request.path === '/rankwarden/hidden' ? { status: 500, body: {} } : undefined,
    );
    expect((await admin({ kind: 'guild', guildId: 77, hidden: true })).status).toBe(502);
  });
});

describe('a hidden player or guild', () => {
  it('drops out of search suggestions', async () => {
    expect((await api('/search/suggestions?type=pvp&q=hid')).body.characters).toHaveLength(1);
    expect((await api('/search/suggestions?type=pve&q=hid')).body.guilds).toHaveLength(2);

    await hideAll();

    expect((await api('/search/suggestions?type=pvp&q=hid')).body.characters).toEqual([]);
    const pve = (await api('/search/suggestions?type=pve&q=hid')).body;
    expect(pve.characters).toEqual([]);
    expect(pve.guilds.map((g: Json) => g.name)).toEqual(['Hidden Guild Two']);
  });

  it('drops off the PvP ladder, with the total', async () => {
    const before = (await api('/pvp/leaderboard?region=eu&seasonId=42&bracket=3v3')).body;
    expect(before.total).toBe(2);

    await hideAll();

    const after = (await api('/pvp/leaderboard?region=eu&seasonId=42&bracket=3v3')).body;
    expect(after.total).toBe(1);
    expect(after.entries.map((e: Json) => e.characterId)).toEqual([2]);
  });

  it('is left out of the title cutoff counts and lists alike', async () => {
    expect((await api('/pvp/cutoffs?region=eu&bracket=3v3')).body.total).toBe(2);

    await hideAll();

    expect((await api('/pvp/cutoffs?region=eu&bracket=3v3')).body.total).toBe(1);
    const list = (await api('/pvp/cutoffs?region=eu&bracket=3v3&class=mage&spec=fire')).body;
    expect(list.characters.map((e: Json) => e.characterId)).toEqual([2]);
  });

  it('drops off the Mythic+ leaderboard', async () => {
    expect((await api('/pve/mplus-leaderboard?region=eu')).body.total).toBe(2);

    await hideAll();

    const after = (await api('/pve/mplus-leaderboard?region=eu')).body;
    expect(after.total).toBe(1);
    expect(after.entries.map((e: Json) => e.characterName)).toEqual(['Shown']);
  });

  it("keeps a run's slot, anonymised as Raider.io anonymises, whatever the name's case", async () => {
    await hideAll();

    const roster = (await api('/pve/mplus-runs?region=eu')).body.runs[0].roster;
    expect(roster[0]).toMatchObject({
      rioCharacterId: 0,
      characterName: 'Anonymous',
      realmSlug: 'anonymous',
      realmId: null,
      className: 'Mage',
      specName: 'Arcane',
      anonymized: true,
    });
    expect(roster[1]).toMatchObject({ characterName: 'Shown', anonymized: false });
  });

  it('answers 404 on its character pages without asking Blizzard or Raider.io', async () => {
    await hideAll();

    const pvp = await api('/pvp/character?region=eu&realmSlug=kazzak&characterName=hîdey');
    const pve = await api('/pve/character?region=eu&realmSlug=kazzak&characterName=HÎDEY');

    expect([pvp.status, pve.status]).toEqual([404, 404]);
    expect(app.upstream.requestsTo('/blizzard')).toHaveLength(0);
    expect(app.upstream.requestsTo('/raiderio')).toHaveLength(0);
  });

  it("answers 404 on a hidden guild's page without asking Raider.io", async () => {
    await hideAll();

    expect((await api('/pve/guild?region=eu&realmSlug=kazzak&guildName=Hidden Guild')).status).toBe(
      404,
    );
    expect(app.upstream.requestsTo('/raiderio')).toHaveLength(0);
  });

  it('drops a hidden guild off the raid board, the others keeping their ranks', async () => {
    expect((await api('/pve/raid?raidSlug=sporefall')).body.guilds).toHaveLength(2);

    await hideAll();

    const guilds = (await api('/pve/raid?raidSlug=sporefall')).body.guilds;
    expect(guilds.map((g: Json) => [g.rank, g.guild.id])).toEqual([[2, 78]]);
  });

  it('comes back when shown again', async () => {
    await hideAll();
    expect((await api('/pve/mplus-leaderboard?region=eu')).body.total).toBe(1);

    expect((await admin({ kind: 'character', ...HIDDEN, hidden: false })).status).toBe(200);
    expect((await admin({ kind: 'guild', guildId: 77, hidden: false })).status).toBe(200);

    expect((await api('/pve/mplus-leaderboard?region=eu')).body.total).toBe(2);
    expect((await api('/pve/raid?raidSlug=sporefall')).body.guilds).toHaveLength(2);
    expect((await api('/search/suggestions?type=pvp&q=hid')).body.characters).toHaveLength(1);
  });
});
