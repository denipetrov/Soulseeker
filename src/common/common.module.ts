import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { DependencyHealthModule } from '@denipetrov/spirit-link/health';

import type { Env } from '../config/env.schema.js';
import { healthSecrets } from './health/upstream-provider.js';
import { BudgetSpentFilter } from './quota/budget-spent.filter.js';
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
  providers: [BlizzardBudget, RaiderIoBudget, { provide: APP_FILTER, useClass: BudgetSpentFilter }],
  exports: [BlizzardBudget, RaiderIoBudget],
})
export class CommonModule {}
