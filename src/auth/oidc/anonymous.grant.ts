import type { KoaContextWithOIDC, Provider, ResourceServer } from 'oidc-provider';

import { ANONYMOUS_GRANT_TYPE, API_READ_SCOPE } from '../auth.constants.js';
import type { AccountService } from './account.service.js';
import type { IssuancePolicy } from './issuance-policy.service.js';

/** Form parameters the anonymous grant accepts besides `grant_type`. */
export const ANONYMOUS_GRANT_PARAMS = ['turnstile_token'];

/**
 * `grant_type=urn:soulseeker:grant-type:anonymous` at the token endpoint.
 *
 * Starts a session for a visitor who has not logged in: a new `anon:` account,
 * a grant scoped to the API, and the token pair. From there the visitor is an
 * ordinary OAuth client — the `refresh_token` grant, rotation, reuse detection
 * and revocation are oidc-provider's own, exactly as they will be for a
 * Battle.net login.
 */
export function anonymousGrantHandler(
  provider: Provider,
  accounts: AccountService,
  policy: IssuancePolicy,
  api: { resource: string; info: ResourceServer },
) {
  return async function anonymousGrant(ctx: KoaContextWithOIDC): Promise<void> {
    await policy.check(ctx);

    const client = ctx.oidc.client!;
    const accountId = accounts.createAnonymous();

    const grant = new provider.Grant({ accountId, clientId: client.clientId });
    grant.addResourceScope(api.resource, API_READ_SCOPE);
    const grantId = await grant.save();

    const accessToken = new provider.AccessToken({
      accountId,
      client,
      grantId,
      gty: ANONYMOUS_GRANT_TYPE,
      scope: API_READ_SCOPE,
    });
    accessToken.resourceServer = new provider.ResourceServer(api.resource, api.info);

    const refreshToken = new provider.RefreshToken({
      accountId,
      client,
      grantId,
      gty: ANONYMOUS_GRANT_TYPE,
      scope: API_READ_SCOPE,
      resource: api.resource,
      // The session's start, which the refresh grant measures total lifetime from.
      iiat: Math.floor(Date.now() / 1000),
      rotations: 0,
    });

    ctx.oidc.entity('Grant', grant);
    ctx.oidc.entity('AccessToken', accessToken);
    ctx.oidc.entity('RefreshToken', refreshToken);

    const accessTokenValue = await accessToken.save();
    const refreshTokenValue = await refreshToken.save();

    ctx.body = {
      access_token: accessTokenValue,
      token_type: 'Bearer',
      expires_in: accessToken.expiration,
      refresh_token: refreshTokenValue,
      scope: API_READ_SCOPE,
    };
  };
}
