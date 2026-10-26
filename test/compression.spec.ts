import { request as httpRequest } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  anonymousTokens,
  bootTestApp,
  resetRedis,
  TEST_CLIENT_ID,
  TEST_ORIGIN,
  type TestApp,
} from './support/app.js';

let app: TestApp;
let token: string;

/** A large guild: every member's base profile, as Raider.io sends it. */
const MEMBERS = Array.from({ length: 300 }, (_, i) => ({
  rank: i % 8,
  character: {
    name: `Member${i}`,
    race: 'Blood Elf',
    class: 'Demon Hunter',
    active_spec_name: 'Vengeance',
    active_spec_role: 'TANK',
    faction: 'horde',
    realm: 'Tarren Mill',
    profile_url: `https://raider.io/characters/eu/tarren-mill/Member${i}`,
  },
}));

interface RawResponse {
  status: number;
  encoding: string | undefined;
  vary: string | undefined;
  /** The bytes as sent, before any decompression. */
  body: Buffer;
}

/**
 * A request whose `Accept-Encoding` is exactly the one given, answered as sent:
 * `fetch` would add its own header and decompress the body before we see it.
 */
function raw(
  path: string,
  acceptEncoding: string | null,
  options: { method?: string; headers?: Record<string, string>; form?: string } = {},
): Promise<RawResponse> {
  const url = new URL(path, app.url);

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          ...(acceptEncoding === null ? {} : { 'accept-encoding': acceptEncoding }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            encoding: res.headers['content-encoding'],
            vary: res.headers.vary,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.form);
  });
}

const roster = (acceptEncoding: string | null) =>
  raw(
    '/pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo&showFullRoster=true',
    acceptEncoding,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000' } });
});

afterAll(async () => {
  await resetRedis(app);
  await app?.close();
});

beforeEach(async () => {
  await resetRedis(app);
  app.upstream.reset();
  app.upstream.route((request) =>
    request.path === '/raiderio/guilds/profile'
      ? {
          status: 200,
          body: {
            name: 'Echo',
            faction: 'horde',
            region: 'eu',
            realm: 'Tarren Mill',
            members: MEMBERS,
          },
        }
      : undefined,
  );
  token = (await anonymousTokens(app)).access_token;
});

describe('response compression', () => {
  it('sends brotli to a client that accepts it, much smaller, and the same JSON', async () => {
    const plain = await roster(null);
    const br = await roster('gzip, deflate, br');

    expect(plain.status).toBe(200);
    expect(plain.encoding).toBeUndefined();
    expect(br.encoding).toBe('br');
    expect(br.vary).toContain('Accept-Encoding');
    expect(br.body.length * 5).toBeLessThan(plain.body.length);
    // The roster is fetched on every call, so only its `fetchedAt` may differ.
    expect(JSON.parse(brotliDecompressSync(br.body).toString())).toEqual({
      ...JSON.parse(plain.body.toString()),
      fetchedAt: expect.any(String),
    });
  });

  it('falls back to gzip for a client without brotli', async () => {
    const gzip = await roster('gzip');

    expect(gzip.encoding).toBe('gzip');
    expect(JSON.parse(gunzipSync(gzip.body).toString()).members).toHaveLength(300);
  });

  it('sends small answers as they are', async () => {
    const session = await raw('/session', 'br', {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(session.status).toBe(200);
    expect(session.body.length).toBeLessThan(1024);
    expect(session.encoding).toBeUndefined();
  });

  it('never compresses health probes or the authorization server', async () => {
    const ready = await raw('/health/ready', 'br');
    const issued = await raw('/oidc/token', 'br', {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      form: new URLSearchParams({
        client_id: TEST_CLIENT_ID,
        grant_type: 'urn:soulseeker:grant-type:anonymous',
      }).toString(),
    });

    // Large enough to be compressed, were it not a probe.
    expect(ready.body.length).toBeGreaterThan(1024);
    expect(ready.encoding).toBeUndefined();
    expect(issued.status).toBe(200);
    expect(issued.encoding).toBeUndefined();
  });
});
