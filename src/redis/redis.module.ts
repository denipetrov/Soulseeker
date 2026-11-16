import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';
import { RefreshCooldown } from './refresh-cooldown.service.js';
import { SharedFlight } from './shared-flight.service.js';

@Global()
@Module({
  providers: [RedisService, SharedFlight, CacheService, RefreshCooldown],
  exports: [RedisService, SharedFlight, CacheService, RefreshCooldown],
})
export class RedisModule {}
