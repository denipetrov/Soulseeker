import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RatingRow } from '../../characters/entities/character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import type { PvpSeason } from '../seasons/pvp-season.types.js';
import { ALL_SPECS } from '../specs.js';
import type { TierListQuery } from './dto/tier-list-query.dto.js';
import {
  MIN_RATING,
  scoreTierList,
  TOP_ROWS,
  type SpecGroup,
  type SpecRef,
} from './tier-list.scoring.js';
import type { TierListResponse } from './tier-list.types.js';

const RATING_COLLECTIONS: Record<TierListQuery['bracket'], ReadCollection> = {
  '2v2': Collections.Ratings2v2,
  '3v3': Collections.Ratings3v3,
  rbg: Collections.RatingsRbg,
  shuffle: Collections.RatingsShuffle,
  blitz: Collections.RatingsBlitz,
};

const LISTED = new Set(ALL_SPECS.map((entry) => `${entry.class}-${entry.spec}`));

/**
 * How good each spec is on one ladder of the current season, as S to D tiers
 * (`tier-list.scoring.ts` has the formula).
 *
 * Two reads of the family's ratings collection, run together:
 * - the top 5,000 rows' class and spec, through `board_order`;
 * - every row at or above 1500 grouped by spec, with its count and mean
 *   rating — ~63,000 rows on EU Shuffle, ~70 ms.
 *
 * Every spec of `ALL_SPECS` is on the list, a spec nobody plays at the
 * bottom with 0 — a tank spec can have no Shuffle row at all. A spec the data
 * has and the list does not (one Blizzard just added) is scored too, and
 * logged, so `src/pvp/specs.ts` can be brought up to date.
 *
 * On 2v2, 3v3 and RBG a row has a spec only once Rankwarden has enriched its
 * character; rows without one hold their place in the top but count for no
 * spec. The list is cached for `TIER_LIST_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class TierListService {
  private readonly logger = new Logger(TierListService.name);
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: PvpSeasonsService,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('TIER_LIST_CACHE_TTL_SECONDS', { infer: true });
  }

  async tierList(query: TierListQuery): Promise<TierListResponse> {
    const season = await this.seasons.currentSeason(query.region);
    if (!season) {
      throw new NotFoundException({
        message: `No current PvP season recorded for ${query.region}`,
      });
    }

    const key = ['pvp:tiers', query.region, season.seasonId, query.bracket].join(':');
    // Null — nothing classified — is not cached, so a ladder appears as soon
    // as Rankwarden enriches it.
    const list = await this.cache.getOrLoad(
      key,
      () => this.compute(query, season),
      this.cacheTtlSeconds,
    );

    if (!list) {
      throw new NotFoundException({
        message: `No ${query.bracket} rows with a known spec yet for season ${season.seasonId} in ${query.region}`,
      });
    }

    return list;
  }

  private async compute(query: TierListQuery, season: PvpSeason): Promise<TierListResponse | null> {
    const ratings = this.mongo.collection<RatingRow>(RATING_COLLECTIONS[query.bracket]);
    const scope = { seasonId: season.seasonId, region: season.region };

    const [top, grouped] = await Promise.all([
      ratings
        .find(scope, { projection: { _id: 0, class: 1, spec: 1 } })
        .sort({ rating: -1 })
        .limit(TOP_ROWS)
        .toArray() as Promise<SpecRef[]>,
      ratings
        .aggregate<{ _id: { class: string; spec: string }; count: number; averageRating: number }>([
          {
            $match: {
              ...scope,
              rating: { $gte: MIN_RATING },
              class: { $ne: null },
              spec: { $ne: null },
            },
          },
          {
            $group: {
              _id: { class: '$class', spec: '$spec' },
              count: { $sum: 1 },
              averageRating: { $avg: '$rating' },
            },
          },
        ])
        .toArray(),
    ]);

    const groups: SpecGroup[] = grouped.map(({ _id, count, averageRating }) => ({
      class: _id.class,
      spec: _id.spec,
      count,
      averageRating,
    }));
    const specs = scoreTierList(top, groups, ALL_SPECS);
    if (specs.length === 0) return null;

    const unlisted = specs
      .map((entry) => `${entry.class}-${entry.spec}`)
      .filter((key) => !LISTED.has(key));
    if (unlisted.length > 0) {
      this.logger.warn(
        `${query.region} ${query.bracket} has specs missing from src/pvp/specs.ts: ${unlisted.join(', ')}`,
      );
    }

    return {
      region: query.region,
      bracket: query.bracket,
      seasonId: season.seasonId,
      seasonName: season.name,
      computedAt: new Date().toISOString(),
      minRating: MIN_RATING,
      topRows: top.length,
      topClassified: top.filter((row) => row.class && row.spec).length,
      classified: groups.reduce((sum, group) => sum + group.count, 0),
      specs,
    };
  }
}
