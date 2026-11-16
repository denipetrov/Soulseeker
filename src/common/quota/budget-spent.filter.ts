import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { BudgetSpentException } from './budget-spent.exception.js';

/**
 * Every budget 503 carries `Retry-After`, whichever route threw it. Global, so
 * a new upstream-backed route cannot forget the header, as two once did
 * (prodlike report, ISSUE-02). The body is Nest's usual one for the exception.
 */
@Catch(BudgetSpentException)
export class BudgetSpentFilter implements ExceptionFilter<BudgetSpentException> {
  catch(exception: BudgetSpentException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
