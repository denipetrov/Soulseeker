import type { ConfigService } from '@nestjs/config';
import type { Middleware } from 'koa';

import type { Env } from '../../config/env.schema.js';
import { docsEnabled } from '../../docs/swagger.js';

/**
 * The browser origins that may obtain tokens: the front end's (`CORS_ORIGINS`),
 * and — wherever the API docs are served — the service's own, so that "Try it
 * out" on `/docs` can run the token endpoint. Never the service's own origin in
 * production, where there are no docs.
 */
export function issuanceOrigins(config: ConfigService<Env, true>): Set<string> {
  const origins = new Set(config.get('CORS_ORIGINS', { infer: true }));

  if (docsEnabled(config)) origins.add(new URL(config.get('OIDC_ISSUER', { infer: true })).origin);

  return origins;
}

/**
 * The token endpoint answers only the allowed origins, for every grant and for
 * the CORS preflight, with one refusal: 403 `access_denied`.
 *
 * In front of oidc-provider, because its own client-based CORS check refuses a
 * foreign origin with 400 `invalid_request` before any grant runs, lets a
 * request with no `Origin` through, and answers every preflight with the origin
 * reflected. So a refresh needed no `Origin`, and the anonymous grant's own
 * 403 was reached only when the header was missing (prodlike report, ISSUE-04
 * and ISSUE-06). The `Origin` is a cost put on scripts, not a secret: it holds
 * only as long as every way to a token asks for it.
 */
export function tokenOriginGate(origins: ReadonlySet<string>, tokenPath = '/token'): Middleware {
  return async (ctx, next) => {
    if (ctx.path !== tokenPath || (ctx.method !== 'POST' && ctx.method !== 'OPTIONS')) {
      return next();
    }

    const origin = ctx.get('origin');
    if (origin && origins.has(origin)) return next();

    ctx.status = 403;
    ctx.set('Cache-Control', 'no-store');
    ctx.type = 'application/json';
    ctx.body = { error: 'access_denied', error_description: 'origin not allowed' };
  };
}
