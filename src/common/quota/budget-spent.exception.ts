import { ServiceUnavailableException } from '@nestjs/common';

/**
 * How long a client should wait after a 503. Blizzard's hour is counted in
 * one-minute buckets and Raider.io's minute in five-second ones, so a minute
 * frees room in either.
 */
export const BUDGET_RETRY_AFTER_SECONDS = 60;

/**
 * A 503 for an upstream budget that is spent while nothing is cached to serve
 * instead. Carries its Retry-After, which the controller sets as a header.
 */
export class BudgetSpentException extends ServiceUnavailableException {
  constructor(
    upstream: string,
    readonly retryAfterSeconds = BUDGET_RETRY_AFTER_SECONDS,
  ) {
    super(`The ${upstream} request budget is spent and this character is not cached; retry later.`);
  }
}
