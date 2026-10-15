import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  anonymousTokens,
  bootTestApp,
  getJson,
  resetRedis,
  tokenRequest,
  type TestApp,
} from './support/app.js';

let app: TestApp;

beforeAll(async () => {
  app = await bootTestApp({
    env: { RATE_LIMIT_TOKEN_PER_MINUTE: '5', RATE_LIMIT_API_PER_MINUTE: '3' },
  });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetRedis(app);
});

const session = (token?: string) =>
  fetch(`${app.url}/session`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('anonymous OAuth session', () => {
  it('publishes discovery and the public signing keys, without private parts', async () => {
    const discovery = await getJson(`${app.url}/oidc/.well-known/openid-configuration`);
    const jwks = (await getJson(`${app.url}/oidc/jwks`)) as { keys: { d?: string }[] };

    expect(discovery.issuer).toBe('http://localhost:3001/oidc');
    expect(discovery.grant_types_supported).toEqual(
      expect.arrayContaining(['refresh_token', 'urn:soulseeker:grant-type:anonymous']),
    );
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys.every((key) => key.d === undefined)).toBe(true);
  });

  it('issues an access token the API accepts, for an anonymous subject', async () => {
    const tokens = await anonymousTokens(app);

    expect(tokens.expires_in).toBe(600);

    const response = await session(tokens.access_token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ anonymous: true, scopes: ['api:read'] });
  });

  it('refuses the API without a token, or with a tampered one', async () => {
    const { access_token } = await anonymousTokens(app);

    const missing = await session();
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');

    expect((await session(`${access_token.slice(0, -2)}xx`)).status).toBe(401);
  });

  it('refuses a token request without an allowed Origin', async () => {
    const response = await tokenRequest(
      app,
      { grant_type: 'urn:soulseeker:grant-type:anonymous' },
      {},
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'access_denied' });
  });

  it('rotates the refresh token, and revokes the session when an old one is replayed', async () => {
    const first = await anonymousTokens(app);

    const refreshed = await tokenRequest(app, {
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { refresh_token: string; access_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await session(second.access_token)).status).toBe(200);

    // A stolen, already-used token: the grant behind both is revoked.
    const replay = await tokenRequest(app, {
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });

    const afterReplay = await tokenRequest(app, {
      grant_type: 'refresh_token',
      refresh_token: second.refresh_token,
    });
    expect(afterReplay.status).toBe(400);
  });

  it('limits new sessions per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(
        (await tokenRequest(app, { grant_type: 'urn:soulseeker:grant-type:anonymous' })).status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('limits API requests per subject, with Retry-After', async () => {
    const { access_token } = await anonymousTokens(app);

    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 4; i += 1) {
      const response = await session(access_token);
      statuses.push(response.status);
      retryAfter = response.headers.get('retry-after') ?? retryAfter;
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
