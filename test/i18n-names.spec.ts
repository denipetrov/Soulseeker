import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisService } from '../src/redis/redis.service.js';
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

const names = (en: string, de: string, zh: string) => ({
  en_US: en,
  es_MX: en,
  pt_BR: en,
  de_DE: de,
  en_GB: en,
  es_ES: en,
  fr_FR: en,
  it_IT: en,
  ru_RU: en,
  ko_KR: en,
  zh_TW: zh,
  zh_CN: zh,
});

/** Blizzard's index answers, by path after `/blizzard/us/`, each named in every language. */
const INDEXES: Record<string, unknown> = {
  'data/wow/playable-class/index': { classes: [{ id: 3, name: names('Hunter', 'Jäger', '猎人') }] },
  'data/wow/playable-specialization/index': {
    character_specializations: [{ id: 262, name: names('Elemental', 'Elementar', '元素') }],
    pet_specializations: [],
  },
  'data/wow/playable-race/index': { races: [{ id: 3, name: names('Dwarf', 'Zwerg', '矮人') }] },
  'data/wow/talent-tree/index': {
    spec_talent_trees: [],
    class_talent_trees: [],
    hero_talent_trees: [{ id: 56, name: names('Farseer', 'Scharfseher', '先知') }],
  },
  'data/wow/keystone-affix/index': {
    affixes: [{ id: 9, name: names('Tyrannical', 'Tyrannisch', '残暴') }],
  },
  'data/wow/mythic-keystone/dungeon/index': {
    dungeons: [{ id: 588, name: names('Altar of Fangs', 'Altar der Fänge', '毒牙祭坛') }],
  },
  'data/wow/journal-instance/index': {
    instances: [{ id: 1305, name: names('Sporefall', 'Sporenfall', '孢陨幽境') }],
  },
  'data/wow/journal-encounter/index': {
    encounters: [{ id: 2871, name: names('Rotmire', 'Moderschlamm', '腐沼') }],
  },
};

const blizzard = () => app.upstream.requestsTo('/blizzard');

async function get(query: string): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(`${app.url}/i18n/names?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return {
    status: response.status,
    body: (await response.json()) as Json,
    headers: response.headers,
  };
}

beforeAll(async () => {
  app = await bootTestApp({
    env: { RATE_LIMIT_API_PER_MINUTE: '1000', BLIZZARD_RETRY_LIMIT: '0' },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertOne({
    id: 1,
    slug: 'sporefall',
    name: 'Sporefall',
    shortName: 'SF',
    icon: null,
    expansionId: 11,
    starts: { us: new Date('2026-10-13T15:00:00Z') },
    ends: {},
    encounters: [{ id: 197162, slug: 'rotmire', name: 'Rotmire' }],
  });
  await db
    .collection('mplus_dungeons')
    .insertOne({ id: 16091, slug: 'altar-of-fangs', name: 'Altar of Fangs', challengeModeId: 588 });

  token = (await anonymousTokens(app)).access_token;
});

afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

beforeEach(async () => {
  await resetRedis(app);
  app.upstream.reset();
  app.upstream.route((request) => {
    const path = request.path.replace(/^\/blizzard\/us\//, '');
    const body = INDEXES[path];
    return body ? { status: 200, body } : undefined;
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /i18n/names', () => {
  it('answers every name in the language asked, keyed as the other answers key them', async () => {
    const { status, body } = await get('locale=de_DE');

    expect(status).toBe(200);
    expect(body).toEqual({
      locale: 'de_DE',
      builtAt: expect.any(String),
      classes: { '3': 'Jäger' },
      specs: { '262': 'Elementar' },
      races: { '3': 'Zwerg' },
      heroTalents: { '56': 'Scharfseher' },
      affixes: { '9': 'Tyrannisch' },
      dungeons: { 'altar-of-fangs': 'Altar der Fänge' },
      raids: { sporefall: { name: 'Sporenfall', bosses: { rotmire: 'Moderschlamm' } } },
    });
  });

  it('asks Blizzard once for every language, with no locale, then serves every language from Redis', async () => {
    await get('locale=de_DE');

    expect(blizzard()).toHaveLength(8);
    expect(blizzard().every((request) => !request.query.has('locale'))).toBe(true);
    expect(
      blizzard()
        .find((request) => request.path.includes('mythic-keystone'))
        ?.query.get('namespace'),
    ).toBe('dynamic-us');
    expect(
      blizzard()
        .find((request) => request.path.includes('playable-class'))
        ?.query.get('namespace'),
    ).toBe('static-us');

    const zh = await get('locale=zh_CN');
    const en = await get('');
    expect(zh.body.classes).toEqual({ '3': '猎人' });
    expect(en.body).toMatchObject({ locale: 'en_US', classes: { '3': 'Hunter' } });
    expect(zh.body.builtAt).toBe(en.body.builtAt);
    expect(blizzard()).toHaveLength(8);
  });

  it('reads the locale in any case or with a hyphen, and refuses one Blizzard does not have', async () => {
    expect((await get('locale=de-de')).body.locale).toBe('de_DE');
    expect((await get('locale=PT_br')).body.locale).toBe('pt_BR');
    expect((await get('locale=xx_YY')).status).toBe(400);
    expect((await get('locale=german')).status).toBe(400);
  });

  it('serves the kept copy when Blizzard fails, and 502 with nothing kept', async () => {
    app.upstream.route((request) =>
      request.path.startsWith('/blizzard') ? { status: 500, body: {} } : undefined,
    );
    expect((await get('locale=de_DE')).status).toBe(502);

    // A week-old copy, past its freshness but kept.
    const redis = app.app.get(RedisService);
    const old = {
      builtAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      classes: { '3': { en_US: 'Hunter', de_DE: 'Jäger' } },
      specs: {},
      races: {},
      heroTalents: {},
      affixes: {},
      dungeons: {},
      raids: {},
      unmatched: { dungeons: [], raids: [], bosses: [] },
    };
    await redis.client.set(redis.key('cache', 'i18n:game-names'), JSON.stringify(old));

    const stale = await get('locale=de_DE');
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ builtAt: old.builtAt, classes: { '3': 'Jäger' } });
  });

  it('needs an access token', async () => {
    expect((await fetch(`${app.url}/i18n/names?locale=de_DE`)).status).toBe(401);
  });
});
