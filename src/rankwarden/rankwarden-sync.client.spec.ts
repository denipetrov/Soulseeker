import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { DependencyHealth } from '@denipetrov/spirit-link/health';
import { afterEach, describe, expect, it } from 'vitest';

import type { Env } from '../config/env.schema.js';
import type { CharacterSyncInput } from './dto/character-sync.dto.js';
import { RankwardenSyncClient } from './rankwarden-sync.client.js';

const CHARACTER: CharacterSyncInput = {
  seasonId: 42,
  region: 'us',
  characterId: 195802602,
  characterName: 'Goküü',
  realmId: 61,
  realmSlug: 'emerald-dream',
  faction: 'HORDE',
  brackets: { '3v3': { rating: 2093, played: 10, won: 5, lost: 5 } },
};

let server: Server | null = null;

/** A stand-in Rankwarden answering each request with the next status in `statuses`. */
async function rankwardenAnswering(...statuses: number[]) {
  const seen: { path: string; body: unknown }[] = [];

  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', body: JSON.parse(raw) });
      res.writeHead(statuses.shift() ?? 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ brackets: 1 }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;
  const settings: Partial<Env> = {
    RANKWARDEN_BASE_URL: `http://127.0.0.1:${port}`,
    RANKWARDEN_TIMEOUT_MS: 2_000,
    RANKWARDEN_SYNC_RETRY_LIMIT: 2,
    RANKWARDEN_SYNC_RETRY_BASE_MS: 1,
  };
  const config = { get: (key: keyof Env) => settings[key] } as ConfigService<Env, true>;
  const health = new DependencyHealth();

  return { client: new RankwardenSyncClient(config, health), seen, health };
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = null;
});

describe('RankwardenSyncClient', () => {
  it('posts the validated payload and reports it written', async () => {
    const { client, seen, health } = await rankwardenAnswering(200);

    await expect(client.pushPvpCharacter(CHARACTER)).resolves.toEqual({
      status: 'written',
      result: { brackets: 1 },
    });
    expect(seen).toEqual([{ path: '/characters/sync', body: CHARACTER }]);
    expect(health.statusFor('rankwarden')).toBe('ok');
  });

  it('retries a 409 with backoff until the job is done', async () => {
    const { client, seen } = await rankwardenAnswering(409, 409, 200);

    await expect(client.pushPvpCharacter(CHARACTER)).resolves.toMatchObject({ status: 'written' });
    expect(seen).toHaveLength(3);
  });

  it('gives up as busy once the retries are spent', async () => {
    const { client, seen } = await rankwardenAnswering(409, 409, 409, 409);

    await expect(client.pushPvpCharacter(CHARACTER)).resolves.toMatchObject({ status: 'busy' });
    expect(seen).toHaveLength(3);
  });

  it('drops a character Rankwarden does not track, without retrying', async () => {
    const { client, seen } = await rankwardenAnswering(404);

    await expect(client.pushPvpCharacter(CHARACTER)).resolves.toMatchObject({
      status: 'not-tracked',
    });
    expect(seen).toHaveLength(1);
  });

  it('refuses an invalid payload before sending it', async () => {
    const { client, seen } = await rankwardenAnswering(200);

    await expect(
      client.pushPvpCharacter({ ...CHARACTER, seasonId: -1 } as CharacterSyncInput),
    ).resolves.toMatchObject({ status: 'invalid' });
    expect(seen).toHaveLength(0);
  });

  it('reports a 5xx as failed and records it against Rankwarden', async () => {
    const { client, health } = await rankwardenAnswering(503);

    await expect(
      client.pushMplusCharacter({
        season: 'season-mn-2',
        region: 'us',
        realmSlug: 'area-52',
        characterName: 'Skollcat',
        dungeonRuns: [],
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(health.failingRegionsFor('rankwarden')).toEqual(['mplus/characters/sync']);
  });
});
