import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { RedisService } from '../../redis/redis.service.js';
import { UpstreamProvider } from '../health/upstream-provider.js';
import { RedisRollingWindow } from './redis-rolling-window.js';
import { RequestBudget } from './request-budget.js';

/**
 * Blizzard: 36,000 an hour and 100 a second per client, of which
 * `BLIZZARD_UTILISATION` is planned against. Both windows are checked on every
 * request.
 */
@Injectable()
export class BlizzardBudget extends RequestBudget {
  constructor(redis: RedisService, config: ConfigService<Env, true>) {
    const utilisation = config.get('BLIZZARD_UTILISATION', { infer: true });

    super(
      UpstreamProvider.Blizzard,
      new RedisRollingWindow(redis.client, redis.key('budget', 'blizzard', ''), [
        {
          name: 'hour',
          windowMs: 3_600_000,
          buckets: 60,
          limit: Math.floor(config.get('BLIZZARD_HOURLY_LIMIT', { infer: true }) * utilisation),
        },
        {
          name: 'second',
          windowMs: 1_000,
          buckets: 10,
          limit: Math.max(
            1,
            Math.floor(config.get('BLIZZARD_PER_SECOND_LIMIT', { infer: true }) * utilisation),
          ),
        },
      ]),
      config.get('BUDGET_WAIT_MS', { infer: true }),
    );
  }
}

/** Raider.io: one rolling minute, `RAIDERIO_MINUTE_LIMIT` × `RAIDERIO_UTILISATION`. */
@Injectable()
export class RaiderIoBudget extends RequestBudget {
  constructor(redis: RedisService, config: ConfigService<Env, true>) {
    super(
      UpstreamProvider.RaiderIo,
      new RedisRollingWindow(redis.client, redis.key('budget', 'raiderio', ''), [
        {
          name: 'minute',
          windowMs: 60_000,
          buckets: 12,
          limit: Math.floor(
            config.get('RAIDERIO_MINUTE_LIMIT', { infer: true }) *
              config.get('RAIDERIO_UTILISATION', { infer: true }),
          ),
        },
      ]),
      config.get('BUDGET_WAIT_MS', { infer: true }),
    );
  }
}
