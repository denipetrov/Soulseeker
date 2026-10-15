import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  providers: [RedisService, CacheService],
  exports: [RedisService, CacheService],
})
export class RedisModule {}
