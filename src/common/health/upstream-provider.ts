import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';

/**
 * The upstreams Soulseeker reports health for, as keys into the shared
 * `DependencyHealth` from `@denipetrov/spirit-link/health`. All are soft
 * dependencies: MongoDB and Redis are the hard ones.
 */
export const UpstreamProvider = {
  Blizzard: 'blizzard',
  RaiderIo: 'raiderio',
  Rankwarden: 'rankwarden',
} as const;
export type UpstreamProvider = (typeof UpstreamProvider)[keyof typeof UpstreamProvider];

/**
 * What `DependencyHealth` must never repeat in a reported error.
 *
 * The Raider.io key travels as a query parameter, so it turns up inside any
 * url an error message quotes. The signing keys never travel, but an error
 * that quotes configuration should not be the way they leak either.
 */
export function healthSecrets(config: ConfigService<Env, true>): string[] {
  return [
    config.get('BLIZZARD_CLIENT_SECRET', { infer: true }),
    config.get('BLIZZARD_CLIENT_ID', { infer: true }),
    config.get('RAIDER_IO_API_KEY', { infer: true }),
    config.get('TURNSTILE_SECRET', { infer: true }),
    ...config.get('OIDC_COOKIE_KEYS', { infer: true }),
  ];
}
