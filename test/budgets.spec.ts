import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ProfileApi } from '../src/blizzard/profile.api.js';
import { BudgetExhaustedError } from '../src/common/quota/request-budget.js';
import { RaiderIoCharacterApi } from '../src/raiderio/character.api.js';
import { RankwardenSyncClient } from '../src/rankwarden/rankwarden-sync.client.js';
import { bootTestApp, getJson, resetRedis, type TestApp } from './support/app.js';

const PROFILE = {
  id: 1,
  name: 'Skollcat',
  level: 80,
  race: { id: 1, name: 'Human' },
  character_class: { id: 8, name: 'Mage' },
  realm: { id: 61, name: 'Area 52', slug: 'area-52' },
};

/** Two replicas: one fake upstream, one database, one Redis prefix. */
let first: TestApp;
let second: TestApp;

beforeAll(async () => {
  // A tiny Blizzard hour so it can be spent inside a test.
  const env = {
    BLIZZARD_HOURLY_LIMIT: '4',
    BLIZZARD_PER_SECOND_LIMIT: '4',
    BLIZZARD_UTILISATION: '1',
    BLIZZARD_RETRY_LIMIT: '1',
    RAIDERIO_MINUTE_LIMIT: '2',
    RAIDERIO_UTILISATION: '1',
    RANKWARDEN_SYNC_RETRY_LIMIT: '2',
    RANKWARDEN_SYNC_RETRY_BASE_MS: '1',
  };
  first = await bootTestApp({ env });
  second = await bootTestApp({ env, upstream: first.upstream });
});

afterAll(async () => {
  await second?.close();
  await first?.close();
});

beforeEach(async () => {
  await resetRedis(first);
  first.upstream.reset();
});

describe('own request budgets', () => {
  it('is one budget across replicas, and a spent one sends nothing upstream', async () => {
    first.upstream.route((request) =>
      request.path.startsWith('/blizzard/us/profile') ? { status: 200, body: PROFILE } : undefined,
    );

    const a = first.app.get(ProfileApi);
    const b = second.app.get(ProfileApi);

    await a.getProfile('us', 'area-52', 'Skollcat');
    await b.getProfile('us', 'area-52', 'Skollcat');
    await a.getProfile('us', 'area-52', 'Skollcat');
    await b.getProfile('us', 'area-52', 'Skollcat');

    await expect(a.getProfile('us', 'area-52', 'Skollcat')).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    await expect(b.getProfile('us', 'area-52', 'Skollcat')).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    expect(first.upstream.requestsTo('/blizzard')).toHaveLength(4);
  });

  it('charges every attempt, retries included', async () => {
    let calls = 0;
    first.upstream.route((request) => {
      if (!request.path.startsWith('/blizzard')) return undefined;
      calls += 1;
      return calls === 1 ? { status: 503, body: {} } : { status: 200, body: PROFILE };
    });

    await first.app.get(ProfileApi).getProfile('us', 'area-52', 'Skollcat');

    const ready = await getJson(`${first.url}/health/ready`);
    const blizzard = ready.budgets.find(
      (budget: { provider: string }) => budget.provider === 'blizzard',
    );
    expect(blizzard.windows.find((w: { name: string }) => w.name === 'hour').spent).toBe(2);
  });

  it('sends the Blizzard token and namespace, and maps a missing character to null', async () => {
    first.upstream.route((request) =>
      request.path.startsWith('/blizzard') ? { status: 404, body: {} } : undefined,
    );

    await expect(
      first.app.get(ProfileApi).getProfile('eu', 'kazzak', 'Nobody'),
    ).resolves.toBeNull();

    const [request] = first.upstream.requestsTo('/blizzard/eu');
    expect(request?.path).toBe('/blizzard/eu/profile/wow/character/kazzak/nobody');
    expect(request?.query.get('namespace')).toBe('profile-eu');
  });

  it('keeps the Raider.io key out of everything but the request itself', async () => {
    first.upstream.route((request) =>
      request.path.startsWith('/raiderio')
        ? { status: 400, body: { message: 'not found' } }
        : undefined,
    );

    await expect(
      first.app.get(RaiderIoCharacterApi).getProfile('us', 'area-52', 'Nobody'),
    ).resolves.toBeNull();

    const [request] = first.upstream.requestsTo('/raiderio');
    expect(request?.query.get('access_key')).toBe('test-raiderio-key');

    const ready = await (await fetch(`${first.url}/health/ready`)).text();
    expect(ready).not.toContain('test-raiderio-key');
  });

  it('retries a busy Rankwarden and then writes', async () => {
    let calls = 0;
    first.upstream.route((request) => {
      if (request.path !== '/rankwarden/mplus/characters/sync') return undefined;
      calls += 1;
      return calls < 3
        ? { status: 409, body: {} }
        : { status: 200, body: { key: 'us/area-52/skollcat' } };
    });

    const outcome = await first.app.get(RankwardenSyncClient).pushMplusCharacter({
      season: 'season-mn-2',
      region: 'us',
      realmSlug: 'area-52',
      characterName: 'Skollcat',
      dungeonRuns: [],
    });

    expect(outcome).toEqual({ status: 'written', result: { key: 'us/area-52/skollcat' } });
    expect(calls).toBe(3);
  });
});
