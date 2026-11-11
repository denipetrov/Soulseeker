import { Injectable, NotFoundException } from '@nestjs/common';

import type { RatingRow } from '../../characters/entities/character.entity.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import {
  BoardEnricher,
  ROW_PROJECTION,
  type BoardRow,
} from '../leaderboard/board-enricher.service.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import type { Cutoff, PvpSeason, SpecFamily } from '../seasons/pvp-season.types.js';
import { regionsOf, WORLD, type PvpBoard } from '../world.js';
import type { CutoffBracket, CutoffsQuery } from './dto/cutoffs-query.dto.js';
import type {
  CutoffCharactersResponse,
  CutoffsResponse,
  SpecCutoffCount,
  SpecLadderCutoff,
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

/** One region's counts, with the season they were read for. */
interface RegionCounts {
  season: PvpSeason;
  specs: SpecCutoffCount[];
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
 * - **`world`**: Blizzard sets cutoffs per region, so there is no world
 *   cutoff. Each region is counted against its own, and the counts summed;
 *   the characters are every region's, by rating. `cutoff` is then null and
 *   `regionCutoffs` gives each region's. A region without cutoffs yet is left
 *   out; only when none has them is it a 404.
 */
@Injectable()
export class CutoffsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly seasons: PvpSeasonsService,
    private readonly enricher: BoardEnricher,
  ) {}

  async cutoffs(query: CutoffsQuery): Promise<CutoffsResponse | CutoffCharactersResponse> {
    const seasons = await this.currentSeasons(query.region);

    if (query.class && query.spec) return this.characters(query, seasons, query.class, query.spec);

    const counted = (
      await Promise.all(
        seasons.map(async (season) => ({
          season,
          specs: isSpecFamily(query.bracket)
            ? await this.perSpecLadder(season, query.bracket)
            : await this.perSpec(season, query.bracket),
        })),
      )
    ).filter((entry): entry is RegionCounts => entry.specs !== null);

    if (counted.length === 0) {
      throw new NotFoundException({
        message: `No ${query.bracket} title cutoffs recorded yet for season ${seasons[0]!.seasonId} in ${query.region}`,
      });
    }

    const world = query.region === WORLD;
    const specs = world ? mergedCounts(counted) : counted[0]!.specs;
    specs.sort((a, b) => b.count - a.count);

    const used = counted.map((entry) => entry.season);
    const response: CutoffsResponse = {
      region: query.region,
      bracket: query.bracket,
      ...seasonFieldsOf(used),
      cutoff: world || isSpecFamily(query.bracket) ? null : used[0]!.cutoffs[query.bracket],
      total: specs.reduce((sum, entry) => sum + entry.count, 0),
      specs,
    };
    if (world && !isSpecFamily(query.bracket)) {
      const bracket = query.bracket;
      response.regionCutoffs = Object.fromEntries(
        used.map((season) => [season.region, season.cutoffs[bracket]]),
      );
    }

    return response;
  }

  /**
   * The current season of each region the board covers. On `world`, the
   * regions on the newest season: at a rollover the others' cutoffs belong to
   * another season. A 404 when no region has one.
   */
  private async currentSeasons(board: PvpBoard): Promise<PvpSeason[]> {
    const found = (
      await Promise.all(regionsOf(board).map((region) => this.seasons.currentSeason(region)))
    ).filter((season): season is PvpSeason => season !== null);
    if (found.length === 0) {
      throw new NotFoundException({ message: `No current PvP season recorded for ${board}` });
    }

    const newest = Math.max(...found.map((season) => season.seasonId));

    return found.filter((season) => season.seasonId === newest);
  }

  /**
   * The characters of one spec who reach the cutoff, best first, as the
   * leaderboard shows them. On Shuffle and Blitz the spec's own ladder and
   * cutoff; on 3v3 and RBG the season's cutoff and the characters whose active
   * spec it is — only those Rankwarden has enriched, as only they have one.
   * Read through `spec_board`, the same range the count is; on `world` once
   * per region, each against its own cutoff, merged by rating.
   */
  private async characters(
    query: CutoffsQuery,
    seasons: PvpSeason[],
    cls: string,
    spec: string,
  ): Promise<CutoffCharactersResponse> {
    const found = (
      await Promise.all(seasons.map((season) => this.qualifying(query.bracket, season, cls, spec)))
    ).filter((entry) => entry !== null);

    if (found.length === 0) {
      throw new NotFoundException({
        message: `No ${query.bracket} title cutoff recorded for ${cls} ${spec} in season ${seasons[0]!.seasonId} in ${query.region}`,
      });
    }

    const used = found.map((entry) => entry.season);
    const rows = found.flatMap((entry) => entry.rows).sort((a, b) => b.rating - a.rating);
    const characters = await this.enricher.entriesAcross(rows, used);
    const world = query.region === WORLD;

    const response: CutoffCharactersResponse = {
      region: query.region,
      bracket: query.bracket,
      class: cls,
      spec,
      ...seasonFieldsOf(used),
      cutoff: world ? null : found[0]!.cutoff,
      total: characters.length,
      characters,
    };
    if (world) {
      response.regionCutoffs = Object.fromEntries(
        found.map((entry) => [entry.season.region, entry.cutoff]),
      );
    }

    return response;
  }

  /**
   * One region's qualifying rows of a spec, with the cutoff they qualify by.
   * Null when the region has no cutoff for it, or the season no such spec.
   */
  private async qualifying(
    bracket: CutoffBracket,
    season: PvpSeason,
    cls: string,
    spec: string,
  ): Promise<{ season: PvpSeason; cutoff: Cutoff | SpecLadderCutoff; rows: BoardRow[] } | null> {
    const cutoff = isSpecFamily(bracket)
      ? season.specCutoffs[bracket][`${cls}-${spec}`]
      : season.cutoffs[bracket];
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

    if (!cutoff || rating === null || unknownSpec) return null;

    const rows = await this.mongo
      .collection<RatingRow>(RATING_COLLECTIONS[bracket])
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

    return { season, cutoff, rows };
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

/**
 * Several regions' counts as one: summed per spec, each spec's own cutoff
 * (Shuffle and Blitz) kept per region in `regionCutoffs`.
 */
function mergedCounts(counted: readonly RegionCounts[]): SpecCutoffCount[] {
  const merged = new Map<string, SpecCutoffCount>();

  for (const { season, specs } of counted) {
    for (const { cutoff, ...entry } of specs) {
      const key = `${entry.class}|${entry.spec}`;
      const into = merged.get(key) ?? { class: entry.class, spec: entry.spec, count: 0 };
      into.count += entry.count;
      if (cutoff) into.regionCutoffs = { ...into.regionCutoffs, [season.region]: cutoff };
      merged.set(key, into);
    }
  }

  return [...merged.values()];
}

/**
 * The season fields of an answer read across some regions: the season's id and
 * name (one season everywhere), final only once every region's is, and the
 * oldest read of the cutoffs — the answer is as fresh as its stalest region.
 */
function seasonFieldsOf(seasons: readonly PvpSeason[]) {
  const fetched = seasons
    .map((season) => season.rewardsFetchedAt)
    .filter((at): at is string => at !== null)
    .sort();

  return {
    seasonId: seasons[0]!.seasonId,
    seasonName: seasons[0]!.name,
    final: seasons.every((season) => season.final),
    rewardsFetchedAt: fetched[0] ?? null,
  };
}
