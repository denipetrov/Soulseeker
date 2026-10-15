import type { RedisClient } from '../redis/redis.service.js';

export interface CountResult {
  allowed: boolean;
  count: number;
  /** Seconds until the current window ends. */
  retryAfterSeconds: number;
}

/**
 * Counts hits per key per fixed window in Redis, shared by every replica.
 *
 * Fixed windows, not rolling ones: a rate limit only has to make scraping
 * expensive, and an INCR per request is the cheapest way to do it. A client can
 * squeeze up to twice the limit across a window boundary, which is acceptable.
 */
export class FixedWindowCounter {
  constructor(
    private readonly redis: RedisClient,
    /** e.g. `ss:rl:token:` */
    private readonly prefix: string,
    private readonly limit: number,
    private readonly windowSeconds = 60,
  ) {}

  async hit(id: string, now = Date.now()): Promise<CountResult> {
    const windowMs = this.windowSeconds * 1000;
    const slot = Math.floor(now / windowMs);
    const key = `${this.prefix}${id}:${slot}`;

    const [count] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, this.windowSeconds + 1)
      .exec()) as unknown as [number, number];

    return {
      allowed: Number(count) <= this.limit,
      count: Number(count),
      retryAfterSeconds: Math.max(1, Math.ceil(((slot + 1) * windowMs - now) / 1000)),
    };
  }
}
