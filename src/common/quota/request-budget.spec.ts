import { describe, expect, it, vi } from 'vitest';

import { UpstreamProvider } from '../health/upstream-provider.js';
import type { RedisRollingWindow, WindowSpec } from './redis-rolling-window.js';
import { BudgetExhaustedError, budgetErrorOf, RequestBudget } from './request-budget.js';

const second: WindowSpec = { name: 'second', windowMs: 1_000, buckets: 10, limit: 90 };
const hour: WindowSpec = { name: 'hour', windowMs: 3_600_000, buckets: 60, limit: 32_400 };

function windowAnswering(...answers: (WindowSpec | null)[]) {
  const tryConsume = vi.fn();
  for (const refusedBy of answers) tryConsume.mockResolvedValueOnce({ ok: !refusedBy, refusedBy });

  return { tryConsume, windows: [hour, second] } as unknown as RedisRollingWindow & {
    tryConsume: typeof tryConsume;
  };
}

describe('RequestBudget', () => {
  it('resolves at once while every window has room', async () => {
    const window = windowAnswering(null);

    await new RequestBudget(UpstreamProvider.Blizzard, window, 2_000).acquire();

    expect(window.tryConsume).toHaveBeenCalledTimes(1);
  });

  it('waits out a full per-second window, then proceeds', async () => {
    const window = windowAnswering(second, null);

    await new RequestBudget(UpstreamProvider.Blizzard, window, 2_000).acquire();

    expect(window.tryConsume).toHaveBeenCalledTimes(2);
  });

  it('fails at once on a spent hour rather than making a person wait for it', async () => {
    const window = windowAnswering(hour);

    await expect(
      new RequestBudget(UpstreamProvider.Blizzard, window, 2_000).acquire(),
    ).rejects.toMatchObject({ name: 'BudgetExhaustedError', window: 'hour', limit: 32_400 });
    expect(window.tryConsume).toHaveBeenCalledTimes(1);
  });

  it('fails once the wait allowance is used up', async () => {
    const window = windowAnswering(second, second, second);

    await expect(
      new RequestBudget(UpstreamProvider.Blizzard, window, 150).acquire(),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
  });
});

describe('budgetErrorOf', () => {
  it('finds the budget error behind got wrapping a hook failure', () => {
    const budget = new BudgetExhaustedError(UpstreamProvider.RaiderIo, 'minute', 900);

    expect(budgetErrorOf(budget)).toBe(budget);
    expect(budgetErrorOf(new Error('wrapped', { cause: budget }))).toBe(budget);
    expect(budgetErrorOf(new Error('other'))).toBeNull();
  });
});
