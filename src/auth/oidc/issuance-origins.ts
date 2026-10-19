import type { ConfigService } from '@nestjs/config';

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
