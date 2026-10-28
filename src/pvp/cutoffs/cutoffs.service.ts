import { Injectable, NotFoundException } from '@nestjs/common';

import type { RatingRow } from '../../characters/entities/character.entity.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { BoardEnricher, ROW_PROJECTION } from '../leaderboard/board-enricher.service.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import type { Cutoff, PvpSeason, SpecFamily } from '../seasons/pvp-season.types.js';
import type { CutoffBracket, CutoffsQuery } from './dto/cutoffs-query.dto.js';
import type {
  CutoffCharactersResponse,
  CutoffsResponse,
  SpecCutoffCount,
} from './cutoffs.types.js';

const RATING_COLLECTIONS: Record<CutoffBracket, ReadCollection> = {
  '3v3': Collections.Ratings3v3,
  rbg: Collections.RatingsRbg,
  shuffle: Collections.RatingsShuffle,
  blitz: Collections.RatingsBlitz,
};

const isSpecFamily = (bracket: CutoffBracket): bracket is SpecFamily =>
  bracket === 'shuffle' || bracket === 'blitz';

/**
 * The rating a count is taken at. Where Blizzard split a cutoff by faction and
 * the two differ — 3v3 and RBG up to season 33, never a live season since —
 * the lower one: the rows carry no faction to tell the two apart, and the lower
 * cutoff counts everyone who can reach a title.
 */
function ratingOf(cutoff: Cutoff): number | null {
  if (cutoff.rating !== null) return cutoff.rating;

  const sides = Object.values(cutoff.factions ?? {}).map((side) => side.rating);

  return sides.length > 0 ? Math.min(...sides) : null;
}

/**
 * The current season's title cutoffs for one ladder family, and how many
 * characters of each spec are at or above them.
 *
 * Cutoffs come from the cached season (`PvpSeasonsService`: Rankwarden's
 * `season_state`, the archive once a season is final). Counts are read live
 * from the family's ratings collection, not cached: each is a short index
 * range — `rating >= cutoff` is the top fraction of a percent of a ladder —
 * so a whole Shuffle answer reads ~600 index keys.
 *
 * - **3v3, RBG**: one cutoff; the qualifying rows grouped by `class` and
 *   `spec`, which are null for characters Rankwarden has not enriched yet.
 * - **Shuffle, Blitz**: one cutoff per spec ladder; one count per spec, each
 *   through `spec_board` (season, region, class, spec, rating), run together.
 * - **With `class` and `spec`**: instead of counts, that spec's qualifying
 *   characters, enriched exactly as the leaderboard's entries are.
 */
@Injectable()
export class CutoffsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly seasons: PvpSeasonsService,
    private readonly enricher: BoardEnricher,
  ) {}

  async cutoffs(query: CutoffsQuery): Promise<CutoffsResponse | CutoffCharactersResponse> {
    const season = await this.seasons.currentSeason(query.region);
    if (!season) {
      throw new NotFoundException({
        message: `No current PvP season recorded for ${query.region}`,
      });
    }

    if (query.class && query.spec) return this.characters(query, season, query.class, query.spec);

    const specs = isSpecFamily(query.bracket)
      ? await this.perSpecLadder(season, query.bracket)
      : await this.perSpec(season, query.bracket);

    if (!specs) {
      throw new NotFoundException({
        message: `No ${query.bracket} title cutoffs recorded yet for season ${season.seasonId} in ${query.region}`,
      });
    }

    specs.sort((a, b) => b.count - a.count);

    return {
      region: query.region,
      bracket: query.bracket,
      seasonId: season.seasonId,
      seasonName: season.name,
      final: season.final,
      rewardsFetchedAt: season.rewardsFetchedAt,
      cutoff: isSpecFamily(query.bracket) ? null : season.cutoffs[query.bracket],
      total: specs.reduce((sum, entry) => sum + entry.count, 0),
      specs,
    };
  }

  /**
   * The characters of one spec who reach the cutoff, best first, as the
   * leaderboard shows them. On Shuffle and Blitz the spec's own ladder and
   * cutoff; on 3v3 and RBG the season's cutoff and the characters whose active
   * spec it is — only those Rankwarden has enriched, as only they have one.
   * Read through `spec_board`, the same range the count is.
   */
  private async characters(
    query: CutoffsQuery,
    season: PvpSeason,
    cls: string,
    spec: string,
  ): Promise<CutoffCharactersResponse> {
    const cutoff = isSpecFamily(query.bracket)
      ? season.specCutoffs[query.bracket][`${cls}-${spec}`]
      : season.cutoffs[query.bracket];
    const rating = cutoff ? ratingOf(cutoff) : null;

    // On 3v3 and RBG any slug would do, answering an empty list for `mage-holy`.
    // The season's spec ladders are the list of specs that exist, so a pair
    // they do not name is refused as Shuffle and Blitz refuse it. Skipped only
    // while the season has no spec cutoffs at all, early in a season.
    const knownSpecs = [
      ...Object.keys(season.specCutoffs.shuffle),
      ...Object.keys(season.specCutoffs.blitz),
    ];
    const unknownSpec = knownSpecs.length > 0 && !knownSpecs.includes(`${cls}-${spec}`);

    if (!cutoff || rating === null || unknownSpec) {
      throw new NotFoundException({
        message: `No ${query.bracket} title cutoff recorded for ${cls} ${spec} in season ${season.seasonId} in ${query.region}`,
      });
    }

    const rows = await this.mongo
      .collection<RatingRow>(RATING_COLLECTIONS[query.bracket])
      .find(
        {
          seasonId: season.seasonId,
          region: season.region,
          class: cls,
          spec,
          rating: { $gte: rating },
        },
        { projection: ROW_PROJECTION },
      )
      .sort({ rating: -1 })
      .toArray();

    const characters = await this.enricher.entries(rows, season);

    return {
      region: query.region,
      bracket: query.bracket,
      class: cls,
      spec,
      seasonId: season.seasonId,
      seasonName: season.name,
      final: season.final,
      rewardsFetchedAt: season.rewardsFetchedAt,
      cutoff,
      total: characters.length,
      characters,
    };
  }

  /** 3v3 and RBG: the qualifying rows, grouped by spec. Null when there is no cutoff. */
  private async perSpec(
    season: PvpSeason,
    bracket: Exclude<CutoffBracket, SpecFamily>,
  ): Promise<SpecCutoffCount[] | null> {
    const cutoff = season.cutoffs[bracket];
    const rating = cutoff ? ratingOf(cutoff) : null;
    if (rating === null) return null;

    const groups = await this.mongo
      .collection<RatingRow>(RATING_COLLECTIONS[bracket])
      .aggregate<{ _id: { class: string | null; spec: string | null }; count: number }>([
        { $match: { seasonId: season.seasonId, region: season.region, rating: { $gte: rating } } },
        {
          $group: {
            _id: { class: { $ifNull: ['$class', null] }, spec: { $ifNull: ['$spec', null] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    return groups.map(({ _id, count }) => ({ class: _id.class, spec: _id.spec, count }));
  }

  /**
   * Shuffle and Blitz: one count per spec ladder with a cutoff, a spec with
   * nobody in range answering 0. Null when the season has no cutoffs at all.
   */
  private async perSpecLadder(
    season: PvpSeason,
    family: SpecFamily,
  ): Promise<SpecCutoffCount[] | null> {
    const ladders = Object.entries(season.specCutoffs[family]);
    if (ladders.length === 0) return null;

    const ratings = this.mongo.collection<RatingRow>(RATING_COLLECTIONS[family]);

    const counted = await Promise.all(
      ladders.map(async ([key, cutoff]) => {
        // `mage-fire`: classes carry no hyphen, so the first one splits.
        const [cls, ...rest] = key.split('-');
        const spec = rest.join('-');
        const rating = ratingOf(cutoff);

        const count =
          rating === null
            ? 0
            : await ratings.countDocuments({
                seasonId: season.seasonId,
                region: season.region,
                class: cls,
                spec,
                rating: { $gte: rating },
              });

        return { class: cls ?? null, spec: spec || null, count, cutoff };
      }),
    );

    return counted;
  }
}
