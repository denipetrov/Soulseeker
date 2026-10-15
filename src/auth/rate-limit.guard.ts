import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { describeError } from '../common/utils/errors.js';
import type { Env } from '../config/env.schema.js';
import { RedisService } from '../redis/redis.service.js';
import type { AuthenticatedRequest } from './access-token.guard.js';
import { FixedWindowCounter } from './fixed-window-counter.js';
import { IS_PUBLIC } from './public.decorator.js';

/**
 * Per-minute ceilings on the API: one per token subject, one per client IP.
 *
 * Both, because each alone is easy to step around: a scraper behind one
 * address can start many sessions, and one session can be spread over many
 * addresses. Runs after `AccessTokenGuard`, which supplies the subject.
 *
 * Fails open: if Redis cannot be reached the request goes through, logged.
 * A limit makes abuse expensive; refusing everyone during an outage would make
 * the outage worse. The upstream budgets are the opposite — they fail closed —
 * because overspending those costs this service its API access.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new RunLogger(RateLimitGuard.name);
  private readonly perSubject: FixedWindowCounter;
  private readonly perIp: FixedWindowCounter;

  constructor(
    private readonly reflector: Reflector,
    redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.perSubject = new FixedWindowCounter(
      redis.client,
      redis.key('rl', 'sub', ''),
      config.get('RATE_LIMIT_API_PER_MINUTE', { infer: true }),
    );
    this.perIp = new FixedWindowCounter(
      redis.client,
      redis.key('rl', 'ip', ''),
      config.get('RATE_LIMIT_API_IP_PER_MINUTE', { infer: true }),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();

    try {
      const [bySubject, byIp] = await Promise.all([
        this.perSubject.hit(req.auth?.subject ?? 'none'),
        this.perIp.hit(req.ip ?? 'unknown'),
      ]);

      const refused = [bySubject, byIp].find((result) => !result.allowed);
      if (!refused) return true;

      http.getResponse<Response>().setHeader('Retry-After', String(refused.retryAfterSeconds));
    } catch (error) {
      this.logger.warn(
        `Rate limit unavailable, letting the request through: ${describeError(error)}`,
      );
      return true;
    }

    throw new HttpException(
      { error: 'too_many_requests', error_description: 'rate limit reached' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
