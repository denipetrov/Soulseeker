import { ServiceUnavailableException } from '@nestjs/common';

/**
 * How long a client should wait after a 503. Blizzard's hour is counted in
 * one-minute buckets and Raider.io's minute in five-second ones, so a minute
 * frees room in either.
 */
export const BUDGET_RETRY_AFTER_SECONDS = 60;

/**
 * A 503 for an upstream budget that is spent while nothing is cached to serve
 * instead. `BudgetSpentFilter` turns it into the response, with its
 * Retry-After, for every route alike.
 */
export class BudgetSpentException extends ServiceUnavailableException {
  /**
   * @param upstream `Blizzard` or `Raider.io`.
   * @param subject What has no cached copy, for the message: `this character`,
   *   `this guild`, `this run`.
   */
  constructor(
    upstream: string,
    subject = 'this answer',
    readonly retryAfterSeconds = BUDGET_RETRY_AFTER_SECONDS,
  ) {
    super(`The ${upstream} request budget is spent and ${subject} is not cached; retry later.`);
  }
}
