import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { logLevelsFor } from '@denipetrov/spirit-link/logging';
import { expect } from 'vitest';

import {
  BLIZZARD_TOKEN_PROVIDER,
  type BlizzardTokenProvider,
} from '../../src/blizzard/auth/token-provider.js';
import { assertTestDatabase, testDbName, testMongoUri, testNameFor } from './database.js';
import { FakeUpstream } from './fake-upstream.js';
import { deleteTestKeys, testRedisPrefix, testRedisUrl } from './redis.js';

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_CLIENT_ID = 'soulseeker-web';

export interface TestApp {
  app: NestExpressApplication;
  /** Base URL of the listening app. */
  url: string;
  /** Blizzard, Raider.io and Rankwarden, all at once. */
  upstream: FakeUpstream;
  dbName: string;
  redisPrefix: string;
  close: () => Promise<void>;
}

/** The configuration the first boot in this file locked in. */
let bootedConfig: Record<string, string> | null = null;

/**
 * `ConfigModule.forRoot()` reads the environment once per module graph, and
 * the graph is cached per test file, so a second boot with different settings
 * would silently run with the first one's. Refused, as in Rankwarden: put a
 * scenario with different configuration in its own file.
 */
function assertConfigUnchanged(resolved: Record<string, string>): void {
  if (!bootedConfig) {
    bootedConfig = resolved;
    return;
  }

  const changed = Object.keys(resolved).filter((key) => bootedConfig![key] !== resolved[key]);
  if (changed.length > 0) {
    throw new Error(
      `This file already booted an app with different configuration (${changed.join(', ')}). ` +
        'Move this scenario into its own test file.',
    );
  }
}

/**
 * Boots the real `AppModule`, configured as `main.ts` configures it, against a
 * real MongoDB and Redis, with every upstream on one local fake.
 *
 * Only the Blizzard token provider is replaced. The HTTP clients are real, so
 * retries, budget charging and key redaction are what is tested.
 *
 * Several boots in one file share the fake, the database and the key prefix —
 * which is how two replicas sharing one budget is expressed.
 */
export async function bootTestApp(
  options: { env?: Record<string, string>; upstream?: FakeUpstream } = {},
): Promise<TestApp> {
  const testPath = expect.getState().testPath;
  const name = testNameFor(testPath);
  const dbName = assertTestDatabase(testDbName(testPath));
  const redisPrefix = testRedisPrefix(name);

  const upstream = options.upstream ?? new FakeUpstream();
  const fakeUrl = options.upstream ? upstream.url : await upstream.start();

  const resolved: Record<string, string> = {
    MONGODB_URI: testMongoUri(),
    MONGODB_DB: dbName,
    REDIS_URL: testRedisUrl(),
    REDIS_KEY_PREFIX: redisPrefix,
    BLIZZARD_API_HOST_TEMPLATE: `${fakeUrl}/blizzard/{region}`,
    RAIDERIO_API_BASE_URL: `${fakeUrl}/raiderio`,
    RANKWARDEN_BASE_URL: `${fakeUrl}/rankwarden`,
    TURNSTILE_VERIFY_URL: `${fakeUrl}/turnstile`,
    CORS_ORIGINS: TEST_ORIGIN,
    ...options.env,
  };

  assertConfigUnchanged(resolved);
  for (const [key, value] of Object.entries(resolved)) process.env[key] = value;

  // Imported only now, so `ConfigModule.forRoot()` sees the environment above.
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/configure-app.js');

  const tokens: BlizzardTokenProvider = { getAccessToken: async () => 'test-blizzard-token' };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BLIZZARD_TOKEN_PROVIDER)
    .useValue(tokens)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useLogger(logLevelsFor('error'));
  configureApp(app);

  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  return {
    app,
    url,
    upstream,
    dbName,
    redisPrefix,
    close: async () => {
      await app.close();
      if (!options.upstream) await upstream.stop();
    },
  };
}

/** Clears this file's Redis keys: budgets, rate limits, OAuth state. */
export function resetRedis(app: TestApp): Promise<number> {
  return deleteTestKeys(app.redisPrefix);
}

/** Obtains an anonymous token pair, as the front end does on first load. */
export async function anonymousTokens(
  app: TestApp,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const response = await tokenRequest(app, {
    grant_type: 'urn:soulseeker:grant-type:anonymous',
  });

  if (response.status !== 200) {
    throw new Error(`anonymous grant failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

export function tokenRequest(
  app: TestApp,
  form: Record<string, string>,
  headers: Record<string, string> = { origin: TEST_ORIGIN },
): Promise<Response> {
  return fetch(`${app.url}/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ client_id: TEST_CLIENT_ID, ...form }),
  });
}

/** A response body to assert on: deliberately loose, since the assertions check its shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export async function getJson(url: string): Promise<Json> {
  return (await fetch(url)).json() as Promise<Json>;
}
