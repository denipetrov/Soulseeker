import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';
import { RefreshCooldown } from './refresh-cooldown.service.js';

@Global()
@Module({
  providers: [RedisService, CacheService, RefreshCooldown],
  exports: [RedisService, CacheService, RefreshCooldown],
})
export class RedisModule {}
