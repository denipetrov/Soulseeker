import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import {
  DependencyHealth,
  hostOf,
  probeObservation,
  worstOf,
  type DependencyStatus,
} from '@denipetrov/spirit-link/health';

import { Public } from '../auth/public.decorator.js';
import { UpstreamProvider } from '../common/health/upstream-provider.js';
import { BlizzardBudget, RaiderIoBudget } from '../common/quota/budgets.js';
import type { BudgetSnapshot } from '../common/quota/request-budget.js';
import type { Env } from '../config/env.schema.js';
import { MongoService } from '../database/mongo.service.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * Liveness and readiness, deliberately split, as in Rankwarden.
 *
 * MongoDB and Redis are hard dependencies: without Mongo there is nothing to
 * serve, without Redis no token can be issued and no upstream request spent
 * safely — readiness answers 503 and traffic is withdrawn. Blizzard, Raider.io
 * and Rankwarden are soft: their outage degrades the status but keeps 200,
 * since restarting would not fix them and stored data still serves. Upstreams
 * are observed from real traffic, never probed. Liveness touches nothing.
 */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly mongoHost: string;
  private readonly redisHost: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly mongo: MongoService,
    private readonly redis: RedisService,
    private readonly dependencies: DependencyHealth<UpstreamProvider>,
    private readonly blizzardBudget: BlizzardBudget,
    private readonly raiderIoBudget: RaiderIoBudget,
  ) {
    // The host, never the URI: a connection string carries its password.
    this.mongoHost = hostOf(config.get('MONGODB_URI', { infer: true }));
    this.redisHost = hostOf(config.get('REDIS_URL', { infer: true }));
  }

  /** Liveness. Process-local only, so it answers under any dependency outage. */
  @Get()
  @ApiOperation({ summary: 'Liveness: the process is up. Touches no dependency.' })
  @ApiOkResponse({ description: 'Always, while the process runs.' })
  status() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness. Pings MongoDB and Redis; reports what real traffic saw of the upstreams. */
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness: MongoDB and Redis pinged, upstreams as real traffic saw them',
  })
  @ApiOkResponse({ description: '`ok` or `degraded` (an upstream is failing).' })
  @ApiServiceUnavailableResponse({ description: 'MongoDB or Redis is unreachable. Same body.' })
  async ready() {
    const [mongoPing, redisPing] = await Promise.all([this.mongo.ping(), this.redis.ping()]);
    const redact = (value: string) => this.dependencies.redact(value);

    const upstream = (provider: UpstreamProvider) => ({
      status: this.dependencies.statusFor(provider),
      failingRegions: this.dependencies.failingRegionsFor(provider),
      regions: this.dependencies.byRegion(provider),
    });
    const upstreams = {
      blizzard: upstream(UpstreamProvider.Blizzard),
      raiderio: upstream(UpstreamProvider.RaiderIo),
      rankwarden: upstream(UpstreamProvider.Rankwarden),
    } satisfies Record<UpstreamProvider, { status: DependencyStatus }>;

    const overall = worstOf([
      mongoPing.ok ? 'ok' : 'down',
      redisPing.ok ? 'ok' : 'down',
      // Soft: down counts as degraded, never as down.
      ...Object.values(upstreams).map(({ status }) => (status === 'down' ? 'degraded' : status)),
    ]);

    const payload = {
      status: overall,
      dependencies: {
        mongo: { host: this.mongoHost, ...probeObservation(mongoPing, redact) },
        redis: { host: this.redisHost, ...probeObservation(redisPing, redact) },
        ...upstreams,
      },
      budgets: redisPing.ok ? await this.budgets() : null,
    };

    // Same body either way, so a probe that reads it need not branch on status.
    if (!mongoPing.ok || !redisPing.ok) throw new ServiceUnavailableException(payload);

    return payload;
  }

  private async budgets(): Promise<BudgetSnapshot[] | null> {
    try {
      return await Promise.all([this.blizzardBudget.snapshot(), this.raiderIoBudget.snapshot()]);
    } catch {
      return null;
    }
  }
}
