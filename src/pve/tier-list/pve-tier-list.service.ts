import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { MplusCharacterDocument } from '../../characters/entities/mplus-character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, MplusBoardIndexes } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { ALL_SPECS, classSlugOf, specSlugOf } from '../../pvp/specs.js';
import {
  scoreTierList,
  TOP_ROWS,
  type SpecGroup,
  type SpecRef,
} from '../../pvp/tier-list/tier-list.scoring.js';
import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';
import { CacheService } from '../../redis/cache.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import { CURRENT_SEASON, MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import type { PveTierListQuery } from './dto/pve-tier-list-query.dto.js';
import type { PveTierListResponse } from './pve-tier-list.types.js';

/** Keystone Master: the Mythic+ counterpart of the PvP tier list's 1500 rating. */
export const MPLUS_MIN_SCORE = 2_000;

const LISTED = new Set(ALL_SPECS.map((entry) => `${entry.class}-${entry.spec}`));

/**
 * How good each spec is in the current Mythic+ season, as S to D tiers, by the
 * PvP tier list's own rules and scoring (`tier-list.scoring.ts`): top tier
 * density 45, representation 35, average score 20, the average weighed by
 * count, and the tier lines moved to the widest score drops.
 *
 * The board is `mplus_characters` by `mythicScore`, each character counted for
 * its profile spec. Two reads, together:
 * - the top 5,000 characters' class and spec — through `mplus_score_board`,
 *   the regions merged in score order on `world` — every character, as the
 *   leaderboard lists them (all are fully covered at that depth);
 * - every **fully covered** character at or above Keystone Master (2000),
 *   grouped by spec with count and mean score, through `mplus_covered_board`.
 *   A partially covered character's score is a partial sum (443 on average
 *   over one dungeon, against 3,691 over all eight), so counting them would
 *   rank specs by Rankwarden's coverage, not by how they play.
 *
 * Every spec of `ALL_SPECS` is listed; a spec the data has that the list does
 * not is scored too, and logged. Cached for `TIER_LIST_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class PveTierListService {
  private readonly logger = new Logger(PveTierListService.name);
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: MplusSeasonResolver,
    private readonly catalogue: PveCatalogue,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('TIER_LIST_CACHE_TTL_SECONDS', { infer: true });
  }

  async tierList(query: PveTierListQuery): Promise<PveTierListResponse> {
    const { slug: season } = await this.seasons.resolve(query.region, CURRENT_SEASON);

    const list = await this.cache.getOrLoad(
      `pve:tiers:${query.region}:${season}`,
      () => this.compute(query.region, season),
      this.cacheTtlSeconds,
    );

    if (!list) {
      throw new NotFoundException({
        message: `No Mythic+ characters with a known spec yet for ${season} in ${query.region}`,
      });
    }

    return list;
  }

  private async compute(region: string, season: string): Promise<PveTierListResponse | null> {
    const characters = this.mongo.collection<MplusCharacterDocument>(Collections.MplusCharacters);
    const scope = region === WORLD ? 'world' : 'region';
    const inRegion: Filter<MplusCharacterDocument> =
      region === WORLD
        ? { region: { $in: [...RAIDERIO_REGIONS] } }
        : { region: region as MplusCharacterDocument['region'] };
    const covered: Filter<MplusCharacterDocument> = {
      season,
      isFullyCovered: true,
      mythicScore: { $gte: MPLUS_MIN_SCORE },
    };
    if (region !== WORLD) covered.region = inRegion.region;

    const [top, grouped, seasonEntry] = await Promise.all([
      characters
        .find(
          { season, ...inRegion },
          {
            projection: { _id: 0, 'profile.classId': 1, 'profile.specId': 1 },
            hint: MplusBoardIndexes.live.score[scope],
          },
        )
        .sort({ mythicScore: -1 })
        .limit(TOP_ROWS)
        .toArray(),
      characters
        .aggregate<{ _id: { classId: number; specId: number | null }; count: number; avg: number }>(
          [
            { $match: covered },
            {
              $group: {
                _id: { classId: '$profile.classId', specId: '$profile.specId' },
                count: { $sum: 1 },
                avg: { $avg: '$mythicScore' },
              },
            },
          ],
          { hint: MplusBoardIndexes.live.covered[scope] },
        )
        .toArray(),
      this.catalogue.mplusSeason(season),
    ]);

    const refs: SpecRef[] = top.map(({ profile }) => ({
      class: classSlugOf(profile.classId),
      spec: specSlugOf(profile.specId),
    }));
    const groups: SpecGroup[] = grouped.flatMap(({ _id, count, avg }) => {
      const cls = classSlugOf(_id.classId);
      const spec = specSlugOf(_id.specId);
      return cls && spec ? [{ class: cls, spec, count, averageRating: avg }] : [];
    });

    const specs = scoreTierList(refs, groups, ALL_SPECS, MPLUS_MIN_SCORE);
    if (specs.length === 0) return null;

    const unlisted = specs.map((s) => `${s.class}-${s.spec}`).filter((key) => !LISTED.has(key));
    if (unlisted.length > 0) {
      this.logger.warn(
        `${region} ${season} has specs missing from src/pvp/specs.ts: ${unlisted.join(', ')}`,
      );
    }

    return {
      region,
      season,
      seasonName: seasonEntry?.name ?? null,
      computedAt: new Date().toISOString(),
      minScore: MPLUS_MIN_SCORE,
      topRows: refs.length,
      topClassified: refs.filter((ref) => ref.class && ref.spec).length,
      classified: groups.reduce((sum, group) => sum + group.count, 0),
      specs,
    };
  }
}
