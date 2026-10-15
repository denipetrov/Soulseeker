import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAccessToken, validateToken, type BlizzardAuthConfig } from '@denipetrov/blizz-auth';
import { DependencyHealth } from '@denipetrov/spirit-link/health';

import { UpstreamProvider } from '../../common/health/upstream-provider.js';
import { describeError } from '../../common/utils/errors.js';
import type { Env } from '../../config/env.schema.js';
import type { BlizzardTokenProvider } from './token-provider.js';

/**
 * Adapter over @denipetrov/blizz-auth. The package owns caching (per
 * region + client id, refreshed 60s before expiry), so this service only binds
 * the validated env to it and exposes the provider seam the HTTP layer injects.
 *
 * Soulseeker's own client id and secret: tokens and quota are never shared
 * with Rankwarden.
 */
@Injectable()
export class BlizzardTokenService implements BlizzardTokenProvider, OnModuleInit {
  private readonly logger = new Logger(BlizzardTokenService.name);
  private readonly credentials: BlizzardAuthConfig;

  constructor(
    config: ConfigService<Env, true>,
    private readonly health: DependencyHealth<UpstreamProvider>,
  ) {
    this.credentials = {
      clientId: config.get('BLIZZARD_CLIENT_ID', { infer: true }),
      clientSecret: config.get('BLIZZARD_CLIENT_SECRET', { infer: true }),
      region: config.get('BLIZZARD_REGION', { infer: true }),
    };
  }

  /**
   * Checks the credentials at boot, loudly, but does not refuse to start.
   *
   * Unlike Rankwarden, which is nothing without Blizzard, this service still
   * serves everything stored in Mongo when Blizzard is away. A Blizzard OAuth
   * outage during a rollout must not crash-loop the API, so a failure here is
   * an error line and a `blizzard` health failure, and the first real request
   * tries again.
   */
  async onModuleInit(): Promise<void> {
    try {
      const result = await validateToken(await this.getAccessToken(), this.credentials);

      if (!result.valid) {
        throw new Error(`token rejected (${result.error.code}): ${result.error.message}`);
      }

      this.logger.log(
        `Blizzard OAuth ready for client ${result.clientId} via ${this.credentials.region}`,
      );
    } catch (error) {
      const reason = this.health.redact(`Blizzard OAuth failed: ${describeError(error)}`);
      this.health.recordFailure(UpstreamProvider.Blizzard, 'oauth', reason);
      this.logger.error(reason);
    }
  }

  getAccessToken(): Promise<string> {
    return getAccessToken(this.credentials);
  }
}
