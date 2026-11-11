import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { Region } from '../../blizzard/blizzard.constants.js';
import type { CharacterDocument, RatingRow } from '../../characters/entities/character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { CLASSES } from '../leaderboard/dto/leaderboard-query.dto.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import { SPEC_FAMILIES, type PvpSeason } from '../seasons/pvp-season.types.js';
import { SPECS_BY_CLASS } from '../specs.js';
import { regionsOf, type PvpBoard } from '../world.js';
import type { HeroTalentsQuery } from './dto/hero-talents-query.dto.js';
import { specStats, treeOf, type TreeProfile } from './hero-talents.stats.js';
import type { HeroTalentsResponse } from './hero-talents.types.js';

const RATING_COLLECTIONS: Record<HeroTalentsQuery['bracket'], ReadCollection> = {
  '2v2': Collections.Ratings2v2,
  '3v3': Collections.Ratings3v3,
  rbg: Collections.RatingsRbg,
  shuffle: Collections.RatingsShuffle,
  blitz: Collections.RatingsBlitz,
};

type Row = Pick<RatingRow, 'region' | 'characterId' | 'rating'>;

/** Only what the tree is read from: talent codes are kilobytes each. */
const PROFILE_PROJECTION = {
  _id: 0,
  characterId: 1,
  'profile.heroTalentTree': 1,
  'profile.talentLoadouts.spec.name': 1,
  'profile.talentLoadouts.heroTalentTree': 1,
} as const;

/**
 * Which hero talent trees each spec's best players use, on one ladder family
 * of the current season.
 *
 * - For every spec of `SPECS_BY_CLASS`, its top `top` rows of the family's
 *   ratings collection, through `spec_board` (season, region, class, spec,
 *   rating) — forty short index walks, run together. On `world` the regions
 *   are `$in`, their ranges merged in rating order. On 2v2, 3v3 and RBG a
 *   row's spec is its character's active spec, known once Rankwarden has
 *   enriched the character; Shuffle and Blitz rows carry their ladder's.
 * - Then those characters' profiles, one `$in` per region — character ids are
 *   unique only within a region — and each one's tree (`treeOf`): the ladder
 *   spec's loadout on Shuffle and Blitz, the active spec's elsewhere. A
 *   character not enriched yet has none, and counts in `characters` but not in
 *   `covered`.
 *
 * Cached in Redis per region, bracket and `top` for
 * `HERO_TALENTS_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class HeroTalentsService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: PvpSeasonsService,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('HERO_TALENTS_CACHE_TTL_SECONDS', { infer: true });
  }

  async heroTalents(query: HeroTalentsQuery): Promise<HeroTalentsResponse> {
    const seasons = await this.currentSeasons(query.region);
    if (seasons.length === 0) {
      throw new NotFoundException({
        message: `No current PvP season recorded for ${query.region}`,
      });
    }

    const response = await this.cache.getOrLoad(
      ['pvp:hero-talents', query.region, seasons[0]!.seasonId, query.bracket, query.top].join(':'),
      () => this.compute(query, seasons),
      this.cacheTtlSeconds,
    );

    return response!;
  }

  /** On `world`, the regions on the newest season, as the tier list reads them. */
  private async currentSeasons(board: PvpBoard): Promise<PvpSeason[]> {
    const found = (
      await Promise.all(regionsOf(board).map((region) => this.seasons.currentSeason(region)))
    ).filter((season): season is PvpSeason => season !== null);
    const newest = Math.max(...found.map((season) => season.seasonId));

    return found.filter((season) => season.seasonId === newest);
  }

  private async compute(
    query: HeroTalentsQuery,
    seasons: PvpSeason[],
  ): Promise<HeroTalentsResponse> {
    const seasonId = seasons[0]!.seasonId;
    const regions = seasons.map((season) => season.region);
    const ratings = this.mongo.collection<RatingRow>(RATING_COLLECTIONS[query.bracket]);
    const perSpec = (SPEC_FAMILIES as readonly string[]).includes(query.bracket);

    const pairs = CLASSES.flatMap((cls) => SPECS_BY_CLASS[cls].map((spec) => ({ cls, spec })));
    const tops = await Promise.all(
      pairs.map(({ cls, spec }) => {
        const filter: Filter<RatingRow> = {
          seasonId,
          region: regions.length === 1 ? regions[0]! : { $in: regions },
          class: cls,
          spec,
        };
        return ratings
          .find(filter, { projection: { _id: 0, region: 1, characterId: 1, rating: 1 } })
          .sort({ rating: -1 })
          .limit(query.top)
          .toArray() as Promise<Row[]>;
      }),
    );

    const profiles = await this.profilesOf(seasonId, tops.flat());

    const stats = pairs.map(({ spec }, i) =>
      specStats(
        spec,
        tops[i]!.map((row) => ({
          rating: row.rating,
          tree: treeOf(profiles.get(`${row.region}:${row.characterId}`), spec, perSpec),
        })),
      ),
    );

    return {
      region: query.region,
      bracket: query.bracket,
      seasonId,
      seasonName: seasons[0]!.name,
      top: query.top,
      computedAt: new Date().toISOString(),
      classes: CLASSES.map((cls) => ({
        class: cls,
        specs: stats.filter((_, i) => pairs[i]!.cls === cls),
      })),
    };
  }

  /** The rows' profiles, keyed `<region>:<characterId>`: one read per region, together. */
  private async profilesOf(
    seasonId: number,
    rows: readonly Row[],
  ): Promise<Map<string, TreeProfile>> {
    const byRegion = new Map<Region, Set<number>>();
    for (const row of rows) {
      const ids = byRegion.get(row.region) ?? new Set<number>();
      ids.add(row.characterId);
      byRegion.set(row.region, ids);
    }

    const profiles = new Map<string, TreeProfile>();
    await Promise.all(
      [...byRegion].map(async ([region, ids]) => {
        const docs = await this.mongo
          .collection<CharacterDocument>(Collections.Characters)
          .find(
            { seasonId, region, characterId: { $in: [...ids] } },
            { projection: PROFILE_PROJECTION },
          )
          .toArray();
        for (const doc of docs) {
          if (doc.profile) profiles.set(`${region}:${doc.characterId}`, doc.profile);
        }
      }),
    );

    return profiles;
  }
}
