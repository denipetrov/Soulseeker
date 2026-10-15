import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import got from 'got';
import { errors, type KoaContextWithOIDC } from 'oidc-provider';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { describeError } from '../../common/utils/errors.js';
import type { Env } from '../../config/env.schema.js';
import { RedisService } from '../../redis/redis.service.js';
import { FixedWindowCounter } from '../fixed-window-counter.js';

/** A refusal with its own HTTP status, in the shape oidc-provider renders. */
class IssuanceRefused extends errors.OIDCProviderError {
  constructor(status: number, error: string, description: string) {
    super(status, error);
    Object.assign(this, { error_description: description });
  }
}

/**
 * Who may obtain an anonymous token: the checks that run before the grant
 * issues one.
 *
 * In the grant handler rather than in front of the token endpoint, because
 * the grant type is in the form body, and the body belongs to oidc-provider —
 * a middleware that read it first would have to parse it a second time.
 *
 * None of this makes scraping impossible. A browser client holds no secret, so
 * anything it sends a scraper can send too. What it does is put a cost on each
 * token: an `Origin` that must be ours, a per-IP ceiling on new sessions, and,
 * when switched on, a Turnstile challenge a script cannot solve cheaply.
 */
@Injectable()
export class IssuancePolicy {
  private readonly logger = new RunLogger(IssuancePolicy.name);
  private readonly origins: Set<string>;
  private readonly perIp: FixedWindowCounter;
  private readonly turnstile: { secret: string; verifyUrl: string } | null;

  constructor(config: ConfigService<Env, true>, redis: RedisService) {
    this.origins = new Set(config.get('CORS_ORIGINS', { infer: true }));
    this.perIp = new FixedWindowCounter(
      redis.client,
      redis.key('rl', 'token', ''),
      config.get('RATE_LIMIT_TOKEN_PER_MINUTE', { infer: true }),
    );
    this.turnstile = config.get('TURNSTILE_ENABLED', { infer: true })
      ? {
          secret: config.get('TURNSTILE_SECRET', { infer: true }),
          verifyUrl: config.get('TURNSTILE_VERIFY_URL', { infer: true }),
        }
      : null;
  }

  async check(ctx: KoaContextWithOIDC): Promise<void> {
    const origin = ctx.get('origin');

    if (!origin || !this.origins.has(origin)) {
      throw new IssuanceRefused(403, 'access_denied', 'origin not allowed');
    }

    const { allowed, retryAfterSeconds } = await this.perIp.hit(ctx.ip);

    if (!allowed) {
      ctx.set('Retry-After', String(retryAfterSeconds));
      throw new IssuanceRefused(
        429,
        'too_many_requests',
        'too many new sessions from this address',
      );
    }

    if (this.turnstile) await this.verifyTurnstile(ctx);
  }

  private async verifyTurnstile(ctx: KoaContextWithOIDC): Promise<void> {
    const token = ctx.oidc.params?.turnstile_token;

    if (typeof token !== 'string' || token.length === 0) {
      throw new IssuanceRefused(400, 'invalid_request', 'turnstile_token is required');
    }

    let success: boolean;
    try {
      const result = await got
        .post(this.turnstile!.verifyUrl, {
          form: { secret: this.turnstile!.secret, response: token, remoteip: ctx.ip },
          timeout: { request: 5_000 },
        })
        .json<{ success?: boolean }>();
      success = result.success === true;
    } catch (error) {
      // Fail closed: an unverifiable challenge is not a passed one.
      this.logger.warn(`Turnstile verification failed: ${describeError(error)}`);
      throw new IssuanceRefused(503, 'temporarily_unavailable', 'challenge could not be verified');
    }

    if (!success) throw new IssuanceRefused(403, 'access_denied', 'challenge failed');
  }
}
