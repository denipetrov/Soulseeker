import type { Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RaiderIoBudget } from '../src/common/quota/budgets.js';
import { CacheService } from '../src/redis/cache.service.js';
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

const SUMMARY_KEY = 'guild:eu:tarren-mill:echo:summary';

const BASE = {
  name: 'Echo',
  displayName: null,
  faction: 'horde',
  region: 'eu',
  realm: 'Tarren Mill',
  last_crawled_at: '2026-10-26T07:14:48.000Z',
  profile_url: 'https://raider.io/guilds/eu/tarren-mill/Echo',
};

const member = (rank: number, name: string) => ({
  rank,
  character: { name, class: 'Mage', realm: 'Tarren Mill' },
});
const MEMBERS = [member(1, 'Officer'), member(4, 'Raider'), member(0, 'Master'), member(7, 'Alt')];

/** What Raider.io's guild profile answers for each field. */
function answerFor(field: string): Record<string, unknown> {
  const [name, raid, difficulty] = field.split(':');
  switch (name) {
    case 'raid_progression':
      return { raid_progression: { 'tier-mn-1': { summary: '9/9 M', total_bosses: 9 } } };
    case 'raid_rankings':
      return { raid_rankings: { 'tier-mn-1': { mythic: { world: 2, region: 1, realm: 1 } } } };
    case 'members':
      return { members: MEMBERS };
    case 'raid_encounters':
      return {
        raid_encounters:
          raid === 'tier-mn-1' && difficulty === 'mythic'
            ? [
                {
                  slug: 'midnight-falls',
                  name: 'Midnight Falls',
                  defeatedAt: '2026-04-07T12:23:33.000Z',
                },
              ]
            : [],
      };
    default:
      return {};
  }
}

const KILL = {
  kill: { pulledAt: '2026-04-07T12:13:37.541Z', durationMs: 596022, isSuccess: true },
  roster: [
    { character: { id: 1, name: 'Gingipumper', talentLoadout: { specId: 64 } }, vantus: true },
  ],
};

const raiderIo = () => app.upstream.requestsTo('/raiderio');

async function guild(query = ''): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(
    `${app.url}/pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  return {
    status: response.status,
    body: (await response.json()) as Json,
    headers: response.headers,
  };
}

beforeAll(async () => {
  app = await bootTestApp({
    env: {
      RATE_LIMIT_API_PER_MINUTE: '1000',
      RAIDERIO_MINUTE_LIMIT: '20',
      RAIDERIO_UTILISATION: '1',
      RAIDERIO_RETRY_LIMIT: '0',
      PVE_CATALOGUE_TTL_SECONDS: '1',
    },
  });
  ({ db, drop } = await openTestDatabase(app.dbName));

  await db.collection('raids').insertOne({
    id: 1,
    slug: 'tier-mn-1',
    name: 'Tier MN 1',
    expansionId: 11,
    starts: { eu: new Date('2026-03-17T15:00:00Z') },
    encounters: [
      { id: 3176, slug: 'imperator-averzian', name: 'Imperator Averzian' },
      { id: 3180, slug: 'midnight-falls', name: 'Midnight Falls' },
    ],
  });
  // The catalogue was read at boot, before this: let its 1 s TTL pass.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
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
    // Raider.io answers 400 for a guild it does not know.
    const known = (request.query.get('name') ?? request.query.get('guild')) === 'echo';
    if (!known && request.path.startsWith('/raiderio/guilds')) {
      return { status: 400, body: { message: 'Could not find requested guild' } };
    }
    if (request.path === '/raiderio/guilds/profile') {
      const fields = request.query.get('fields')?.split(',') ?? [];
      return { status: 200, body: Object.assign({ ...BASE }, ...fields.map(answerFor)) };
    }
    if (request.path === '/raiderio/guilds/boss-kill') {
      // Not killed on Normal yet: Raider.io answers an empty object.
      return { status: 200, body: request.query.get('difficulty') === 'mythic' ? KILL : {} };
    }
    return undefined;
  });
  token = (await anonymousTokens(app)).access_token;
});

describe('GET /guild', () => {
  it('answers the summary with ranks 0 and 1 only, then serves it from the cache', async () => {
    const first = await guild();

    expect(first.status).toBe(200);
    expect(raiderIo()[0]?.query.get('fields')?.split(',')).toEqual([
      'raid_progression:current-expansion',
      'raid_rankings:current-expansion',
      'members',
    ]);
    expect(first.body).toEqual({
      region: 'eu',
      realmSlug: 'tarren-mill',
      guild: {
        name: 'Echo',
        displayName: null,
        faction: 'horde',
        realm: 'Tarren Mill',
        region: 'eu',
        profileUrl: 'https://raider.io/guilds/eu/tarren-mill/Echo',
        lastCrawledAt: '2026-10-26T07:14:48.000Z',
      },
      raidProgression: { 'tier-mn-1': { summary: '9/9 M', total_bosses: 9 } },
      raidRankings: { 'tier-mn-1': { mythic: { world: 2, region: 1, realm: 1 } } },
      members: [member(0, 'Master'), member(1, 'Officer')],
      fetchedAt: expect.any(String),
      stale: false,
    });
    // Only the kept members are cached.
    const cached = await app.app.get(CacheService).get<Json>(SUMMARY_KEY);
    expect(cached?.members).toHaveLength(2);

    expect((await guild()).body).toEqual(first.body);
    expect(raiderIo()).toHaveLength(1);
  });

  it('answers the full roster on every call, never cached', async () => {
    const roster = await guild('&showFullRoster=true');
    await guild('&showFullRoster=true');

    expect(roster.status).toBe(200);
    expect(raiderIo()[0]?.query.get('fields')).toBe('members');
    expect(roster.body.members).toEqual(MEMBERS);
    expect(roster.body).not.toHaveProperty('raidProgression');
    expect(raiderIo()).toHaveLength(2);
    expect(await app.app.get(CacheService).get(SUMMARY_KEY)).toBeNull();
  });

  it('answers one raid’s encounters on one difficulty, cached apart', async () => {
    const raid = await guild('&raidEncounters=tier-mn-1&difficulty=mythic');

    expect(raiderIo()[0]?.query.get('fields')).toBe('raid_encounters:tier-mn-1:mythic');
    expect(raid.body).toMatchObject({
      raid: 'tier-mn-1',
      difficulty: 'mythic',
      guild: { name: 'Echo' },
      encounters: [{ slug: 'midnight-falls', defeatedAt: '2026-04-07T12:23:33.000Z' }],
    });
    expect(raid.body).not.toHaveProperty('members');

    await guild('&raidEncounters=tier-mn-1&difficulty=mythic');
    expect(raiderIo()).toHaveLength(1);
  });

  it('answers a boss kill as Raider.io returns it, from the boss-kill endpoint', async () => {
    const boss = await guild('&raidEncounters=tier-mn-1&boss=midnight-falls&difficulty=mythic');

    const [request] = raiderIo();
    expect(request?.path).toBe('/raiderio/guilds/boss-kill');
    expect(Object.fromEntries(request!.query)).toMatchObject({
      region: 'eu',
      realm: 'tarren-mill',
      guild: 'echo',
      raid: 'tier-mn-1',
      boss: 'midnight-falls',
      difficulty: 'mythic',
    });
    expect(boss.body).toMatchObject({
      guildName: 'echo',
      raid: 'tier-mn-1',
      boss: 'midnight-falls',
      difficulty: 'mythic',
      kill: KILL.kill,
      roster: KILL.roster,
      stale: false,
    });
  });

  it('answers no kill for a boss the guild has not killed', async () => {
    const boss = await guild('&raidEncounters=tier-mn-1&boss=midnight-falls&difficulty=normal');

    expect(boss.status).toBe(200);
    expect(boss.body).toMatchObject({ kill: null, roster: [] });
  });

  it('refuses a raid or boss the catalogue does not hold, without asking Raider.io', async () => {
    const raid = await guild('&raidEncounters=no-such-raid&difficulty=mythic');
    const boss = await guild('&raidEncounters=tier-mn-1&boss=kazzara&difficulty=mythic');

    expect(raid.status).toBe(400);
    expect(raid.body.issues).toEqual([{ path: 'raidEncounters', message: 'is not a known raid' }]);
    expect(boss.status).toBe(400);
    expect(boss.body.issues).toEqual([{ path: 'boss', message: 'is not a boss of tier-mn-1' }]);
    expect(raiderIo()).toHaveLength(0);
  });

  it('refuses two widgets in one call', async () => {
    const response = await guild('&showFullRoster=true&raidEncounters=tier-mn-1&difficulty=mythic');

    expect(response.status).toBe(400);
    expect(raiderIo()).toHaveLength(0);
  });

  it('answers 404 for a guild Raider.io does not know, for every widget', async () => {
    const lookup = (query: string) =>
      fetch(`${app.url}/pve/guild?region=eu&realmSlug=tarren-mill&guildName=Nobody${query}`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((response) => response.status);

    expect(await lookup('')).toBe(404);
    expect(await lookup('&showFullRoster=true')).toBe(404);
    expect(await lookup('&raidEncounters=tier-mn-1&boss=midnight-falls&difficulty=mythic')).toBe(
      404,
    );
  });

  it('honours forceRefresh once per cooldown', async () => {
    await guild();
    await guild('&forceRefresh=true');
    await guild('&forceRefresh=true');

    expect(raiderIo()).toHaveLength(2);
  });

  describe('with the Raider.io budget spent', () => {
    async function spendBudget(): Promise<void> {
      const budget = app.app.get(RaiderIoBudget);
      for (;;) {
        try {
          await budget.acquire();
        } catch {
          return;
        }
      }
    }

    it('serves the expired summary, marked stale', async () => {
      await guild();
      const cache = app.app.get(CacheService);
      const summary = (await cache.get<Json>(SUMMARY_KEY))!;
      await cache.set(SUMMARY_KEY, { ...summary, fetchedAt: '2026-01-01T00:00:00.000Z' });

      await spendBudget();
      app.upstream.requests.length = 0;
      const response = await guild();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ stale: true, fetchedAt: '2026-01-01T00:00:00.000Z' });
      expect(raiderIo()).toHaveLength(0);
    });

    it('answers 503 with Retry-After for the roster, which is never kept', async () => {
      await spendBudget();
      const response = await guild('&showFullRoster=true');

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('60');
    });
  });
});
