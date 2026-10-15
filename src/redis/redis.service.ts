import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

import type { Env } from '../config/env.schema.js';
import type { PingResult } from '../database/mongo.service.js';

export type RedisClient = ReturnType<typeof createClient>;

/** How long one ping answers for, as with MongoDB's. */
const PING_CACHE_MS = 3_000;

/**
 * Owns the Redis connection and namespaces every key under `REDIS_KEY_PREFIX`.
 *
 * Redis is a hard dependency: the request budgets, the rate limits and the
 * authorization server's grants all live in it, so without it the service can
 * neither issue a token nor spend an upstream request safely.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: RedisClient;
  private readonly prefix: string;
  private cachedPing: { at: number; result: PingResult } | null = null;
  private lastErrorLoggedAt = 0;

  constructor(config: ConfigService<Env, true>) {
    this.prefix = config.get('REDIS_KEY_PREFIX', { infer: true });
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      socket: {
        connectTimeout: 5_000,
        // Back off to a reconnect every few seconds, forever: an outage ends on
        // its own, and readiness reports it in the meantime.
        reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
      },
    });

    // Without a listener an `error` event crashes the process. One line per
    // ten seconds is enough to see an outage without a line per retry.
    this.client.on('error', (error: unknown) => {
      if (Date.now() - this.lastErrorLoggedAt < 10_000) return;

      this.lastErrorLoggedAt = Date.now();
      this.logger.warn(`Redis: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Connected to Redis');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
    this.logger.log('Redis connection closed');
  }

  /** A key under this service's prefix: `key('rl', 'ip', addr)` → `ss:rl:ip:<addr>`. */
  key(...parts: (string | number)[]): string {
    return `${this.prefix}${parts.join(':')}`;
  }

  async ping(): Promise<PingResult> {
    const now = Date.now();

    if (this.cachedPing && now - this.cachedPing.at < PING_CACHE_MS) {
      return this.cachedPing.result;
    }

    const startedAt = Date.now();
    let result: PingResult;

    try {
      if (!this.client.isReady) throw new Error('not connected');
      await this.client.ping();
      result = { ok: true, latencyMs: Date.now() - startedAt, error: null };
    } catch (error) {
      result = {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.cachedPing = { at: now, result };

    return result;
  }
}
