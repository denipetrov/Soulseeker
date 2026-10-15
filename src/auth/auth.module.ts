import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import type { Env } from '../config/env.schema.js';
import { RedisService } from '../redis/redis.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { OIDC_PROVIDER, SIGNING_KEYS } from './auth.constants.js';
import { AccountService } from './oidc/account.service.js';
import { IssuancePolicy } from './oidc/issuance-policy.service.js';
import { createOidcProvider } from './oidc/oidc-provider.factory.js';
import { resolveSigningKeys, type SigningKeys } from './oidc/signing-keys.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionController } from './session.controller.js';

/**
 * The authorization server (mounted at /oidc by `configureApp`) and the two
 * global guards every API route passes: the access token, then the rate limit.
 * Guards run in the order they are registered here.
 */
@Module({
  controllers: [SessionController],
  providers: [
    AccountService,
    IssuancePolicy,
    {
      provide: SIGNING_KEYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        resolveSigningKeys(config.get('OIDC_JWKS', { infer: true })),
    },
    {
      provide: OIDC_PROVIDER,
      inject: [ConfigService, RedisService, AccountService, IssuancePolicy, SIGNING_KEYS],
      useFactory: (
        config: ConfigService<Env, true>,
        redis: RedisService,
        accounts: AccountService,
        policy: IssuancePolicy,
        keys: SigningKeys,
      ) => createOidcProvider(config, redis, accounts, policy, keys),
    },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [OIDC_PROVIDER],
})
export class AuthModule {}
