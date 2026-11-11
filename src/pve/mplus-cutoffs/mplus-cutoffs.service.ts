import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import type { Env } from '../../config/env.schema.js';
import { RaiderIoMythicPlusApi } from '../../raiderio/mythic-plus.api.js';
import type { RaiderIoCutoffAnalysisPayload } from '../../raiderio/schemas/cutoff-analysis.schema.js';
import { CacheService } from '../../redis/cache.service.js';
import { MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import type { MplusCutoffsQuery } from './dto/mplus-cutoffs-query.dto.js';

/**
 * A Mythic+ season's percentile cutoffs, day by day: a proxy for Raider.io's
 * `mythic-plus/cutoff-analysis/summary`, its answer passed on as it comes.
 *
 * `region` is a region or `world`, which Raider.io takes as it is. `season`
 * resolves as on the other Mythic+ endpoints (`MplusSeasonResolver`): an
 * unknown slug is a 404 before Raider.io is asked. A season Raider.io has no
 * analysis for — none before The War Within's later seasons — is a 404 too,
 * and not cached.
 *
 * Cached in Redis per season and region for `MPLUS_CUTOFFS_CACHE_TTL_SECONDS`
 * (an hour): Raider.io dates its snapshot by day.
 */
@Injectable()
export class MplusCutoffsService {
  private readonly logger = new Logger(MplusCutoffsService.name);
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mythicPlus: RaiderIoMythicPlusApi,
    private readonly cache: CacheService,
    private readonly seasons: MplusSeasonResolver,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_CUTOFFS_CACHE_TTL_SECONDS', { infer: true });
  }

  async cutoffs(query: MplusCutoffsQuery): Promise<RaiderIoCutoffAnalysisPayload> {
    const { slug: season } = await this.seasons.resolve(query.region, query.season);

    const analysis = await this.cache.getOrLoad(
      `pve:mplus-cutoffs:${season}:${query.region}`,
      () => this.fetch(season, query.region),
      this.cacheTtlSeconds,
    );

    if (!analysis) {
      throw new NotFoundException({
        message: `No Mythic+ cutoff analysis for ${season} in ${query.region}`,
      });
    }

    return analysis;
  }

  private async fetch(
    season: string,
    region: string,
  ): Promise<RaiderIoCutoffAnalysisPayload | null> {
    try {
      return await this.mythicPlus.getCutoffAnalysis(season, region);
    } catch (error) {
      const spent = budgetErrorOf(error);
      if (spent) {
        this.logger.warn(`Cutoffs ${season}/${region} not fetched: ${spent.message}`);
        throw new BudgetSpentException('Raider.io');
      }
      this.logger.warn(`Cutoffs ${season}/${region} not fetched: ${describeError(error)}`);
      throw new BadGatewayException('Raider.io could not be reached; retry later.');
    }
  }
}
