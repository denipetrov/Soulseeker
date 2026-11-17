import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';

import { describeError } from '../common/utils/errors.js';
import { RedisService } from './redis.service.js';

/** How long a claimed load may hold its lock: past the slowest page (~14 upstream calls, 10 s each at worst). */
export const FLIGHT_LOCK_MS = 30_000;
/** How often a waiting caller looks for the other replica's result. */
export const FLIGHT_POLL_MS = 150;

/** What a flight answered, and whether this caller is the one that loaded it. */
export interface Flight<T> {
  value: T;
  /**
   * True only for the one caller, on one replica, whose `load` ran. Callers that
   * waited for it — on this replica or another — get false. Work that must
   * happen once per fetch (a sync to Rankwarden) keys off this.
   */
  loaded: boolean;
}

/**
 * One load per key across every replica.
 *
 * `SingleFlight` shares a load between callers of one process. With two to six
 * replicas behind round-robin, the same uncached page asked on two of them was
 * still fetched twice, spending the upstream budget twice and pushing the same
 * ratings to Rankwarden twice, which rotates `previousRating` a second time and
 * hides the movement (prodlike report, ISSUE-01).
 *
 * Here the first caller claims `<prefix>lock:<key>` with `SET NX PX` and loads.
 * `load` must store its result where `peek` reads it (the cache) before it
 * returns: the lock is released only after, so a waiter that sees the lock gone
 * always finds the result. Every other caller polls `peek` until it answers;
 * if the lock goes away with nothing to peek (the load failed, or found
 * nothing), the waiter claims the lock itself and loads.
 *
 * `peek` must answer only a result newer than what the caller already had —
 * for a forced refresh, the fresh copy it found does not count.
 *
 * Fails open: without Redis every caller loads, as before.
 */
@Injectable()
export class SharedFlight {
  private readonly logger = new Logger(SharedFlight.name);
  private readonly local = new Map<string, Promise<Flight<unknown>>>();

  constructor(private readonly redis: RedisService) {}

  async run<T>(
    key: string,
    load: () => Promise<T>,
    peek: () => Promise<T | null>,
  ): Promise<Flight<T>> {
    const pending = this.local.get(key) as Promise<Flight<T>> | undefined;
    if (pending) return pending.then(({ value }) => ({ value, loaded: false }));

    const started = this.acrossReplicas(key, load, peek).finally(() => this.local.delete(key));
    this.local.set(key, started);

    return started;
  }

  private async acrossReplicas<T>(
    key: string,
    load: () => Promise<T>,
    peek: () => Promise<T | null>,
  ): Promise<Flight<T>> {
    const lockKey = this.redis.key('lock', key);
    const deadline = Date.now() + FLIGHT_LOCK_MS;

    for (;;) {
      const token = randomUUID();

      if (await this.claim(lockKey, token)) {
        try {
          // Another replica may have stored it between our cache read and the claim.
          const stored = await peek();
          if (stored !== null) return { value: stored, loaded: false };

          return { value: await load(), loaded: true };
        } finally {
          await this.release(lockKey, token);
        }
      }

      // Another replica is loading it: wait for its result.
      for (;;) {
        if (Date.now() >= deadline) {
          this.logger.warn(`Gave up waiting for ${key}; loading it here`);
          return { value: await load(), loaded: true };
        }

        await sleep(FLIGHT_POLL_MS);
        // Held first, then peek: the loader stores before it releases, so a
        // lock seen gone means its result, if any, is already readable.
        const held = await this.held(lockKey);
        const stored = await peek();
        if (stored !== null) return { value: stored, loaded: false };
        if (!held) break;
      }
    }
  }

  /** True when this caller holds the lock, or when Redis cannot say (fail open). */
  private async claim(lockKey: string, token: string): Promise<boolean> {
    try {
      const claimed = await this.redis.client.set(lockKey, token, {
        condition: 'NX',
        expiration: { type: 'PX', value: FLIGHT_LOCK_MS },
      });

      return claimed === 'OK';
    } catch (error) {
      this.logger.warn(`Flight lock unavailable, loading anyway: ${describeError(error)}`);
      return true;
    }
  }

  private async held(lockKey: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(lockKey)) === 1;
    } catch {
      return false;
    }
  }

  /** Deletes the lock only if it is still this caller's: it may have expired and been claimed again. */
  private async release(lockKey: string, token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_SCRIPT, { keys: [lockKey], arguments: [token] });
    } catch (error) {
      this.logger.warn(`Flight lock not released, it expires on its own: ${describeError(error)}`);
    }
  }
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;
