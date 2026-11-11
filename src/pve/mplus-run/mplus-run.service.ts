import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';
import { RaiderIoMythicPlusApi } from '../../raiderio/mythic-plus.api.js';
import { CacheService } from '../../redis/cache.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import { CURRENT_SEASON, MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import type { MplusRunQuery } from './dto/mplus-run-query.dto.js';
import type { MplusRunResponse } from './mplus-run.types.js';

/**
 * One Mythic+ run's details, from Raider.io's `mythic-plus/run-details`.
 *
 * Raider.io needs the run's season, and answers another season's run of the
 * same id when given the wrong one. So the season is, in order: the one asked
 * for (checked against the catalogue, a 404 if unknown); the season of the run
 * as Rankwarden stores it — `mplus_runs` through `run_identity`, else
 * `mplus_archive_runs` through `archive_run_identity`, both point reads of
 * season × region `$in` lists; else the current season.
 *
 * A finished run does not change, so the answer is cached in Redis per season
 * and run for `MPLUS_RUN_CACHE_TTL_SECONDS` (a day). A run Raider.io does not
 * know is a 404 and is not cached.
 */
@Injectable()
export class MplusRunService {
  private readonly logger = new Logger(MplusRunService.name);
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly runs: RaiderIoMythicPlusApi,
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly catalogue: PveCatalogue,
    private readonly seasons: MplusSeasonResolver,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_RUN_CACHE_TTL_SECONDS', { infer: true });
  }

  async run(query: MplusRunQuery): Promise<MplusRunResponse> {
    const season = query.season
      ? (await this.seasons.resolve(WORLD, query.season)).slug
      : await this.seasonOf(query.keystoneRunId);

    const run = await this.cache.getOrLoad(
      `pve:mplus-run:${season}:${query.keystoneRunId}`,
      () => this.fetch(season, query.keystoneRunId),
      this.cacheTtlSeconds,
    );

    if (!run) {
      throw new NotFoundException({
        message: `No Mythic+ run ${query.keystoneRunId} in ${season}`,
      });
    }

    return run;
  }

  /** The run's season as Rankwarden stores the run, or the current season. */
  private async seasonOf(keystoneRunId: number): Promise<string> {
    const slugs = (await this.catalogue.mplusSeasons()).map((season) => season.slug);
    const [live, archived] = await Promise.all([
      this.mongo
        .collection<{ season: string }>(Collections.MplusRuns)
        .findOne(
          { season: { $in: slugs }, region: { $in: [...RAIDERIO_REGIONS] }, keystoneRunId },
          { projection: { _id: 0, season: 1 } },
        ),
      this.mongo
        .collection<{ season: string }>(Collections.MplusArchiveRuns)
        .findOne({ season: { $in: slugs }, keystoneRunId }, { projection: { _id: 0, season: 1 } }),
    ]);

    return (
      live?.season ?? archived?.season ?? (await this.seasons.resolve(WORLD, CURRENT_SEASON)).slug
    );
  }

  private async fetch(season: string, keystoneRunId: number): Promise<MplusRunResponse | null> {
    let payload;
    try {
      payload = await this.runs.getRunDetails(season, keystoneRunId);
    } catch (error) {
      const spent = budgetErrorOf(error);
      if (spent) {
        this.logger.warn(`Run ${season}/${keystoneRunId} not fetched: ${spent.message}`);
        throw new BudgetSpentException('Raider.io');
      }
      this.logger.warn(`Run ${season}/${keystoneRunId} not fetched: ${describeError(error)}`);
      throw new BadGatewayException('Raider.io could not be reached; retry later.');
    }

    if (!payload) return null;

    return {
      season: payload.season,
      keystone_run_id: payload.keystone_run_id,
      dungeon: payload.dungeon,
      mythic_level: payload.mythic_level,
      score: payload.score ?? null,
      clear_time_ms: payload.clear_time_ms ?? null,
      keystone_time_ms: payload.keystone_time_ms ?? null,
      time_remaining_ms: payload.time_remaining_ms ?? null,
      num_chests: payload.num_chests ?? null,
      completed_at: payload.completed_at ?? null,
      faction: payload.faction ?? null,
      weekly_modifiers: payload.weekly_modifiers ?? [],
      roster: payload.roster ?? [],
    };
  }
}
