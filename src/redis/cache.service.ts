import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { describeError } from '../common/utils/errors.js';
import type { Env } from '../config/env.schema.js';
import { RedisService } from './redis.service.js';
import { SharedFlight } from './shared-flight.service.js';

/**
 * JSON values in Redis with a TTL, under `<prefix>cache:`.
 *
 * A cache failure never fails a request: a read that errors is a miss, and a
 * write that errors is dropped. The source of truth is always Mongo or an
 * upstream, so the cost of Redis being away is latency and budget, not a
 * wrong answer.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtlSeconds: number;
  /** In-process single flight: one loader per key at a time on this replica. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly redis: RedisService,
    private readonly flights: SharedFlight,
    config: ConfigService<Env, true>,
  ) {
    this.defaultTtlSeconds = config.get('CACHE_DEFAULT_TTL_SECONDS', { infer: true });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(this.redis.key('cache', key));

      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${describeError(error)}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    try {
      await this.redis.client.set(this.redis.key('cache', key), JSON.stringify(value), {
        expiration: { type: 'EX', value: ttlSeconds },
      });
    } catch (error) {
      this.logger.warn(`Cache write failed for ${key}: ${describeError(error)}`);
    }
  }

  /** Several values in one round trip; a missing or unreadable one is null. */
  async getMany<T>(keys: readonly string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];

    try {
      const raw = await this.redis.client.mGet(keys.map((key) => this.redis.key('cache', key)));

      return raw.map((value) => (value === null ? null : (JSON.parse(value) as T)));
    } catch (error) {
      this.logger.warn(`Cache read failed for ${keys.length} keys: ${describeError(error)}`);
      return keys.map(() => null);
    }
  }

  /**
   * Several values in one transaction, all with the same TTL, so they expire
   * together and a reader never finds half of a set.
   */
  async setMany(
    entries: ReadonlyMap<string, unknown>,
    ttlSeconds = this.defaultTtlSeconds,
  ): Promise<void> {
    if (entries.size === 0) return;

    try {
      const multi = this.redis.client.multi();
      for (const [key, value] of entries) {
        multi.set(this.redis.key('cache', key), JSON.stringify(value), {
          expiration: { type: 'EX', value: ttlSeconds },
        });
      }
      await multi.exec();
    } catch (error) {
      this.logger.warn(`Cache write failed for ${entries.size} keys: ${describeError(error)}`);
    }
  }

  /**
   * Deletes every cached value whose key starts with one of `prefixes`, by
   * `SCAN` (never `KEYS`, which blocks Redis). Answers how many went; 0 when
   * Redis is away, as a cache failure never fails a request.
   */
  async deleteByPrefix(prefixes: readonly string[]): Promise<number> {
    let deleted = 0;

    try {
      for (const prefix of prefixes) {
        const match = `${this.redis.key('cache', prefix)}*`;
        for await (const batch of this.redis.client.scanIterator({ MATCH: match, COUNT: 500 })) {
          const keys = (Array.isArray(batch) ? batch : [batch]) as string[];
          if (keys.length > 0) deleted += await this.redis.client.del(keys);
        }
      }
    } catch (error) {
      this.logger.warn(`Cache purge failed for ${prefixes.join(', ')}: ${describeError(error)}`);
    }

    return deleted;
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.client.del(this.redis.key('cache', key));
    } catch (error) {
      this.logger.warn(`Cache delete failed for ${key}: ${describeError(error)}`);
    }
  }

  /**
   * The cached value, or the loader's result stored for next time.
   *
   * Concurrent callers on this replica for the same key share one load, so a
   * burst of visitors to the same profile costs one upstream request, not one
   * each. A loader resolving to null is not cached: "not found" is often a
   * character mid-transfer, and pinning it for a TTL would hide them.
   *
   * `acrossReplicas` extends that to every replica (`SharedFlight`), for
   * loaders that spend an upstream budget. MongoDB-backed answers leave it off:
   * the lock's round trips would cost more than the duplicate read.
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    ttlSeconds = this.defaultTtlSeconds,
    options: { acrossReplicas?: boolean } = {},
  ): Promise<T | null> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    if (options.acrossReplicas) {
      const flight = await this.flights.run<T | null>(
        `cache:${key}`,
        async () => {
          const value = await loader();
          if (value !== null) await this.set(key, value, ttlSeconds);
          return value;
        },
        () => this.get<T>(key),
      );

      return flight.value;
    }

    const pending = this.inFlight.get(key) as Promise<T | null> | undefined;
    if (pending) return pending;

    const load = (async () => {
      try {
        const value = await loader();
        if (value !== null) await this.set(key, value, ttlSeconds);

        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, load);

    return load;
  }
}
