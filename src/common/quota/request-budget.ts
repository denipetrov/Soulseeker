import type { UpstreamProvider } from '../health/upstream-provider.js';
import { RedisRollingWindow, type WindowSpec } from './redis-rolling-window.js';

/**
 * The request was not sent because this service's own budget for the upstream
 * is spent. Callers serve what Mongo or the cache already hold instead.
 */
export class BudgetExhaustedError extends Error {
  constructor(
    readonly provider: UpstreamProvider,
    readonly window: string,
    readonly limit: number,
  ) {
    super(`${provider} budget spent: ${limit} requests per ${window} reached`);
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * The budget error behind a failed request, if that is what failed it.
 *
 * The budget is acquired inside got's `beforeRequest` hook, and got wraps
 * whatever a hook throws in a `RequestError` of its own, so the original may be
 * one level down.
 */
export function budgetErrorOf(error: unknown): BudgetExhaustedError | null {
  if (error instanceof BudgetExhaustedError) return error;
  if (error instanceof Error && error.cause instanceof BudgetExhaustedError) return error.cause;

  return null;
}

export interface BudgetSnapshot {
  provider: UpstreamProvider;
  windows: { name: string; windowMs: number; usable: number; spent: number }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Soulseeker's own request budget for one upstream.
 *
 * Separate from Rankwarden's in every way: its own credentials upstream, its
 * own counters here. And shared across replicas through Redis, unlike
 * Rankwarden's in-memory one, because a BFF runs more than one instance.
 *
 * Every attempt is charged, retries included — the upstream counts them the
 * same way.
 */
export class RequestBudget {
  constructor(
    readonly provider: UpstreamProvider,
    private readonly window: RedisRollingWindow,
    /** How long a request may wait for a short window to roll. */
    private readonly maxWaitMs: number,
  ) {}

  /**
   * Resolves once one request may be sent, or throws `BudgetExhaustedError`.
   *
   * Only a window shorter than `maxWaitMs` is waited out — the per-second one.
   * A spent hour or minute fails at once: a person is behind the request, and
   * a stale answer now beats a fresh one in a minute.
   */
  async acquire(): Promise<void> {
    const deadline = Date.now() + this.maxWaitMs;

    for (;;) {
      const { ok, refusedBy } = await this.window.tryConsume(1);
      if (ok) return;

      const refused = refusedBy as WindowSpec;
      const waitMs = RedisRollingWindow.retryAfterMs(refused);

      if (refused.windowMs > this.maxWaitMs || Date.now() + waitMs > deadline) {
        throw new BudgetExhaustedError(this.provider, refused.name, refused.limit);
      }

      await sleep(waitMs);
    }
  }

  async snapshot(): Promise<BudgetSnapshot> {
    const usage = await this.window.usage();

    return {
      provider: this.provider,
      windows: this.window.windows.map((window) => ({
        name: window.name,
        windowMs: window.windowMs,
        usable: window.limit,
        spent: usage[window.name] ?? 0,
      })),
    };
  }
}
