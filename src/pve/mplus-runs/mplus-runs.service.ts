import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { Env } from '../../config/env.schema.js';
import { Collections, MplusRunIndexes } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { MAX_OFFSET } from '../../pvp/leaderboard/dto/leaderboard-query.dto.js';
import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';
import { CacheService } from '../../redis/cache.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import { MplusSeasonsService } from '../mplus-seasons/mplus-seasons.service.js';
import { MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import type { MplusRunsQuery } from './dto/mplus-runs-query.dto.js';
import type { MplusRun, MplusRunsResponse } from './mplus-runs.types.js';

interface RunDocument extends Omit<MplusRun, 'rank' | 'completedAt'> {
  season: string;
  completedAt: Date;
  /** Set on a live run Rankwarden is about to prune: never on the board. */
  missedSince?: Date;
}

const PROJECTION = {
  _id: 0,
  keystoneRunId: 1,
  region: 1,
  score: 1,
  dungeon: 1,
  mythicLevel: 1,
  clearTimeMs: 1,
  keystoneTimeMs: 1,
  timeRemainingMs: 1,
  numChests: 1,
  completedAt: 1,
  affixIds: 1,
  faction: 1,
  roster: 1,
} as const;

/**
 * The Mythic+ run board, one page at a time, best `score` first, from
 * Rankwarden's `mplus_runs` (the live season) or `mplus_archive_runs` (any
 * other; `MplusSeasonResolver` decides).
 *
 * - **Dungeon** is a slug of the season's dungeons (`GET /pve/mplus-seasons`),
 *   matched by its id, which the indexes carry; a slug the season does not run
 *   is a 404.
 * - **Reads** are hinted to the board index (`MplusRunIndexes`). On the live
 *   `world` board the region is spelled out as `$in` every region, so the
 *   per-region ranges merge in score order. A live run Rankwarden is about to
 *   prune (`missedSince`) is never listed.
 * - **Total** is counted per board, not per page, and cached apart: the
 *   `missedSince` check makes the live `world` count read every run (~0.5 s
 *   for ~800,000), and every page of a board shares it.
 *
 * Pages and totals are cached in Redis for `MPLUS_RUNS_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class MplusRunsService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: MplusSeasonResolver,
    private readonly seasonList: MplusSeasonsService,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_RUNS_CACHE_TTL_SECONDS', { infer: true });
  }

  async runs(query: MplusRunsQuery): Promise<MplusRunsResponse> {
    const { slug: season, live } = await this.seasons.resolve(query.region, query.season);
    const dungeonId = query.dungeon ? await this.dungeonId(season, query.dungeon) : null;

    const board = ['pve:mplus-runs', query.region, season, query.dungeon ?? '-'].join(':');
    const filter = this.filter(query.region, season, dungeonId, live);
    const hint = this.hint(query.region, dungeonId, live);

    const [runs, total] = await Promise.all([
      this.cache.getOrLoad(
        `${board}:${query.page}:${query.pageSize}`,
        () => this.page(filter, hint, live, query),
        this.cacheTtlSeconds,
      ),
      this.cache.getOrLoad(
        `${board}:total`,
        () => this.collection(live).countDocuments(filter, { hint }),
        this.cacheTtlSeconds,
      ),
    ]);

    return {
      region: query.region,
      season,
      current: live,
      dungeon: query.dungeon,
      page: query.page,
      pageSize: query.pageSize,
      total: total!,
      totalPages: Math.min(
        Math.ceil(total! / query.pageSize),
        Math.floor(MAX_OFFSET / query.pageSize) + 1,
      ),
      runs: runs!,
    };
  }

  /** The id of a dungeon the season runs, by slug. */
  private async dungeonId(season: string, slug: string): Promise<number> {
    const { seasons } = await this.seasonList.seasons();
    const dungeon = seasons
      .find((entry) => entry.slug === season)
      ?.dungeons.find((entry) => entry.slug === slug);
    if (!dungeon) {
      throw new NotFoundException({ message: `No dungeon ${slug} in ${season}` });
    }

    return dungeon.id;
  }

  private filter(
    region: string,
    season: string,
    dungeonId: number | null,
    live: boolean,
  ): Filter<RunDocument> {
    const filter: Filter<RunDocument> = { season };
    if (region !== WORLD) filter.region = region;
    else if (live) filter.region = { $in: [...RAIDERIO_REGIONS] };
    if (dungeonId !== null) filter['dungeon.id'] = dungeonId;
    if (live) filter.missedSince = { $exists: false };

    return filter;
  }

  private hint(region: string, dungeonId: number | null, live: boolean): string {
    if (live) return dungeonId !== null ? MplusRunIndexes.live.dungeon : MplusRunIndexes.live.board;
    // The archive has no region and dungeon index: a dungeon is the narrower range.
    if (dungeonId !== null) return MplusRunIndexes.archive.dungeon;

    return region === WORLD ? MplusRunIndexes.archive.board : MplusRunIndexes.archive.region;
  }

  private collection(live: boolean) {
    return this.mongo.collection<RunDocument>(
      live ? Collections.MplusRuns : Collections.MplusArchiveRuns,
    );
  }

  private async page(
    filter: Filter<RunDocument>,
    hint: string,
    live: boolean,
    query: MplusRunsQuery,
  ): Promise<MplusRun[]> {
    const offset = (query.page - 1) * query.pageSize;
    const docs = await this.collection(live)
      .find(filter, { projection: PROJECTION, hint })
      .sort({ score: -1 })
      .skip(offset)
      .limit(query.pageSize)
      .toArray();

    return docs.map((doc, i) => ({
      rank: offset + i + 1,
      keystoneRunId: doc.keystoneRunId,
      region: doc.region,
      score: doc.score,
      dungeon: doc.dungeon,
      mythicLevel: doc.mythicLevel,
      clearTimeMs: doc.clearTimeMs,
      keystoneTimeMs: doc.keystoneTimeMs ?? null,
      timeRemainingMs: doc.timeRemainingMs ?? null,
      numChests: doc.numChests ?? null,
      completedAt: new Date(doc.completedAt).toISOString(),
      affixIds: doc.affixIds ?? [],
      faction: doc.faction ?? null,
      roster: doc.roster ?? [],
    }));
  }
}
