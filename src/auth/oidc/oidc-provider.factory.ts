import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Provider, { errors, type ResourceServer } from 'oidc-provider';

import type { Env } from '../../config/env.schema.js';
import type { RedisService } from '../../redis/redis.service.js';
import { ANONYMOUS_GRANT_TYPE, API_READ_SCOPE, SIGNING_ALG } from '../auth.constants.js';
import type { AccountService } from './account.service.js';
import { ANONYMOUS_GRANT_PARAMS, anonymousGrantHandler } from './anonymous.grant.js';
import type { IssuancePolicy } from './issuance-policy.service.js';
import { redisAdapterFactory } from './oidc-redis.adapter.js';
import type { SigningKeys } from './signing-keys.js';

/**
 * The OAuth 2.0 authorization server, configured for this service.
 *
 * One public client, the front end: no secret (a browser cannot keep one), and
 * two grants — the anonymous one and `refresh_token`. Access tokens are JWTs
 * for one resource, the API, so the API verifies them locally against the
 * public keys without a call back here.
 *
 * Built for Battle.net login to slot in later: that adds `authorization_code`
 * with PKCE to the client and an interaction that sends the visitor to
 * Battle.net, and the API's checks stay as they are.
 */
export function createOidcProvider(
  config: ConfigService<Env, true>,
  redis: RedisService,
  accounts: AccountService,
  policy: IssuancePolicy,
  keys: SigningKeys,
): Provider {
  const issuer = config.get('OIDC_ISSUER', { infer: true });
  const resource = config.get('OIDC_API_RESOURCE', { infer: true });
  const origins = new Set(config.get('CORS_ORIGINS', { infer: true }));
  const accessTokenTtl = config.get('OIDC_ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  const refreshTokenTtl = config.get('OIDC_REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  const sessionMax = config.get('OIDC_SESSION_MAX_SECONDS', { infer: true });

  let cookieKeys = config.get('OIDC_COOKIE_KEYS', { infer: true });
  if (cookieKeys.length === 0) {
    // Required in production by the configuration. Only signs cookies of the
    // interactive flows, which nothing uses yet.
    cookieKeys = [randomBytes(32).toString('base64url')];
  }

  const api: ResourceServer = {
    scope: API_READ_SCOPE,
    audience: resource,
    accessTokenTTL: accessTokenTtl,
    accessTokenFormat: 'jwt',
    jwt: { sign: { alg: SIGNING_ALG } },
  };

  const provider = new Provider(issuer, {
    adapter: redisAdapterFactory(redis.client, config.get('REDIS_KEY_PREFIX', { infer: true })),
    clients: [
      {
        client_id: config.get('OIDC_CLIENT_ID', { infer: true }),
        token_endpoint_auth_method: 'none',
        grant_types: [ANONYMOUS_GRANT_TYPE, 'refresh_token'],
        response_types: [],
        redirect_uris: [],
        // The provider's default is RS256; the keys here are ES256 only.
        id_token_signed_response_alg: SIGNING_ALG,
      },
    ],
    jwks: keys.privateJwks as never,
    cookies: { keys: cookieKeys },
    findAccount: (_ctx, sub) => accounts.find(sub),
    // No OpenID scopes: there is no identity to hand out yet. API access is a
    // resource scope, on the resource server below.
    scopes: [],
    claims: {},
    features: {
      devInteractions: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, indicator) => {
          if (indicator !== resource) throw new errors.InvalidTarget();
          return api;
        },
      },
    },
    ttl: {
      AccessToken: accessTokenTtl,
      RefreshToken: refreshTokenTtl,
      // The grant is the session: refreshing rotates the token, not the grant,
      // so this is the longest an anonymous session lives however active.
      Grant: sessionMax,
      Session: sessionMax,
    },
    // Rotate on every use; oidc-provider revokes the whole grant when a
    // rotated-out token is presented again.
    rotateRefreshToken: true,
    // Configuring this is also what switches the `refresh_token` grant on. The
    // anonymous grant mints its own refresh token; this decides for the
    // authorization-code flow a Battle.net login will bring.
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    // Only the code flow is ever offered, and only once a login needs it.
    responseTypes: ['code'],
    clientBasedCORS: (_ctx, origin) => origins.has(origin),
    enabledJWA: { authorizationSigningAlgValues: [SIGNING_ALG] },
    pkce: { required: () => true },
    renderError: (ctx, out) => {
      ctx.type = 'application/json';
      ctx.body = out;
    },
  });

  // Behind the gateway the client address is in X-Forwarded-For, and only the
  // last `hops` entries are ours: earlier ones are whatever the client sent.
  const hops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (hops > 0) {
    provider.proxy = true;
    provider.app.maxIpsCount = hops;
  }

  provider.registerGrantType(
    ANONYMOUS_GRANT_TYPE,
    anonymousGrantHandler(provider, accounts, policy, { resource, info: api }),
    ANONYMOUS_GRANT_PARAMS,
  );

  const logger = new Logger('Oidc');
  // Server-side errors only: a client's invalid_grant is routine, not news.
  provider.on('server_error', (_ctx, error: Error) =>
    logger.error(`OIDC server error: ${error.message}`),
  );
  provider.on('grant.revoked', (_ctx, grantId: string) =>
    logger.debug(`Grant revoked: ${grantId}`),
  );

  return provider;
}
