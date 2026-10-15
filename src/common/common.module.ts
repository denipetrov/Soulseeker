import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DependencyHealthModule } from '@denipetrov/spirit-link/health';

import type { Env } from '../config/env.schema.js';
import { healthSecrets } from './health/upstream-provider.js';
import { BlizzardBudget, RaiderIoBudget } from './quota/budgets.js';

@Global()
@Module({
  imports: [
    // One shared tracker for the whole application: the HTTP clients write to
    // it and the health controller reads from it.
    DependencyHealthModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({ secrets: healthSecrets(config) }),
    }),
  ],
  providers: [BlizzardBudget, RaiderIoBudget],
  exports: [BlizzardBudget, RaiderIoBudget],
})
export class CommonModule {}
