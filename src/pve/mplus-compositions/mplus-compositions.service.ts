import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { CacheService } from '../../redis/cache.service.js';
import { MplusRunsService } from '../mplus-runs/mplus-runs.service.js';
import { topCompositions, type RosterSlot } from './compositions.js';
import type { MplusCompositionsQuery } from './dto/mplus-compositions-query.dto.js';
import type { MplusCompositionsResponse } from './mplus-compositions.types.js';

const ROSTER_PROJECTION = {
  _id: 0,
  'roster.classId': 1,
  'roster.className': 1,
  'roster.specId': 1,
  'roster.specName': 1,
  'roster.role': 1,
} as const;

/**
 * The most played Mythic+ compositions: the board of `GET /pve/mplus-runs` —
 * same region, season and dungeon, same collection, index and pruning rule,
 * through `MplusRunsService.board` — read to its `top` best runs, each roster
 * reduced to its class and spec pairs, and the 50 most frequent of those
 * returned (`topCompositions`).
 *
 * One index walk of `top` runs, projected to the roster's class and spec
 * fields. Cached in Redis per board and `top` for
 * `MPLUS_RUNS_CACHE_TTL_SECONDS`, as the runs are.
 */
@Injectable()
export class MplusCompositionsService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly runs: MplusRunsService,
    private readonly cache: CacheService,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_RUNS_CACHE_TTL_SECONDS', { infer: true });
  }

  async compositions(query: MplusCompositionsQuery): Promise<MplusCompositionsResponse> {
    const board = await this.runs.board(query.region, query.season, query.dungeon);

    const response = await this.cache.getOrLoad(
      `pve:mplus-compositions:${board.id}:${query.top}`,
      async (): Promise<MplusCompositionsResponse> => {
        const docs = await board.collection
          .find(board.filter, { projection: ROSTER_PROJECTION, hint: board.hint })
          .sort({ score: -1 })
          .limit(query.top)
          .toArray();
        const rosters = docs.map((doc) => (doc.roster ?? []) as RosterSlot[]);

        return {
          region: query.region,
          season: board.season,
          current: board.live,
          dungeon: query.dungeon,
          top: query.top,
          runs: rosters.length,
          compositions: topCompositions(rosters),
        };
      },
      this.cacheTtlSeconds,
    );

    return response!;
  }
}
