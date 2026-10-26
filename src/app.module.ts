import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CharactersModule } from './characters/characters.module.js';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { PveModule } from './pve/pve.module.js';
import { PvpModule } from './pvp/pvp.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    CommonModule,
    AuthModule,
    CharactersModule,
    SearchModule,
    PvpModule,
    PveModule,
    HealthModule,
  ],
})
export class AppModule {}
