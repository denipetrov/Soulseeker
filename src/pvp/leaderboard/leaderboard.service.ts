import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { ArchiveEntry, RatingRow } from '../../characters/entities/character.entity.js';
import type { Region } from '../../blizzard/blizzard.constants.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import { regionsOf, WORLD, type PvpBoard } from '../world.js';
import {
  CORE_BRACKETS,
  type CoreBracket,
  type Cutoff,
  type PvpSeason,
  type SpecFamily,
} from '../seasons/pvp-season.types.js';
import type { LeaderboardBracket, LeaderboardQuery } from './dto/leaderboard-query.dto.js';
import { BoardEnricher, ROW_PROJECTION } from './board-enricher.service.js';
import { archivedEntry } from './leaderboard.mapper.js';
import type { LeaderboardResponse } from './leaderboard.types.js';

/** The flat ratings collection each ladder family lives in. */
const RATING_COLLECTIONS: Record<LeaderboardBracket, ReadCollection> = {
  '2v2': Collections.Ratings2v2,
  '3v3': Collections.Ratings3v3,
  rbg: Collections.RatingsRbg,
  shuffle: Collections.RatingsShuffle,
  blitz: Collections.RatingsBlitz,
};

const ARCHIVE_PROJECTION = {
  _id: 0,
  // Each row's own region: on `world`, which region's cutoff it is judged by.
  region: 1,
  characterId: 1,
  characterName: 1,
  realmSlug: 1,
  faction: 1,
  bracket: 1,
  rank: 1,
  rating: 1,
  played: 1,
  won: 1,
  lost: 1,
} as const;

const isCore = (bracket: LeaderboardBracket): bracket is CoreBracket =>
  (CORE_BRACKETS as readonly string[]).includes(bracket);

/**
 * The PvP leaderboards, one page at a time.
 *
 * - **Current season** (the one `season_state` names live): rows from the flat
 *   `*_ratings` collection of the family, best first, then one batch read of
 *   `characters` for names, records and profiles. Class and spec filter on the
 *   rows themselves, through Rankwarden's `class_board` and `spec_board`
 *   indexes. On 2v2, 3v3 and RBG a row has a class only once its character is
 *   enriched, so a class filter there leaves out characters not enriched yet.
 * - **Archived season**: rows from `archive_entries`, which carry everything
 *   inline and no profile. One archived ladder at a time: 2v2, 3v3 and RBG take
 *   no class or spec, and Shuffle and Blitz — archived per spec only — must
 *   name both, which picks that spec's ladder.
 *
 * On `world` the same season is read across every region (`region: $in`),
 * which the indexes — season, then region — merge in rating order. Each row is
 * enriched from, and measured against the cutoff of, its own region; the
 * board's `cutoff` is then null and `regionCutoffs` gives each region's.
 *
 * Paged with skip and limit. That reads index keys only — 100,000 deep costs
 * ~40 ms on the largest board — and gives the front end page numbers. Whole
 * pages are cached in Redis for `LEADERBOARD_CACHE_TTL_SECONDS`: Rankwarden
 * rewrites the ladders hourly.
 */
@Injectable()
export class LeaderboardService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: PvpSeasonsService,
    private readonly enricher: BoardEnricher,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('LEADERBOARD_CACHE_TTL_SECONDS', { infer: true });
  }

  async leaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse> {
    const seasons = await this.boardSeasons(query.region, query.seasonId);
    if (seasons.length === 0) {
      throw new NotFoundException({
        message: `No PvP season ${query.seasonId} in ${query.region}`,
      });
    }

    const current = seasons[0]!.current;
    if (!current) this.assertArchivedFilters(query);

    const key = [
      'pvp:board',
      query.region,
      query.seasonId,
      query.bracket,
      query.class ?? '-',
      query.spec ?? '-',
      query.page,
      query.pageSize,
    ].join(':');

    const page = await this.cache.getOrLoad(
      key,
      () => (current ? this.currentBoard(query, seasons) : this.archivedBoard(query, seasons)),
      this.cacheTtlSeconds,
    );

    return page!;
  }

  /**
   * The season in each region the board covers, all live or all archived. On
   * `world` a region without the season is left out, and at a rollover — the
   * season live in one region and archived in another — the live regions are
   * the board, as their ladders are the ones still moving.
   */
  private async boardSeasons(board: PvpBoard, seasonId: number): Promise<PvpSeason[]> {
    const found = (
      await Promise.all(regionsOf(board).map((region) => this.seasons.season(region, seasonId)))
    ).filter((season): season is PvpSeason => season !== null);
    const live = found.filter((season) => season.current);

    return live.length > 0 ? live : found;
  }

  private assertArchivedFilters({ bracket, class: cls, spec }: LeaderboardQuery): void {
    if (isCore(bracket) && (cls || spec)) {
      throw new BadRequestException({
        message: 'Archived seasons are not filtered by class or spec',
      });
    }

    if (!isCore(bracket) && !(cls && spec)) {
      throw new BadRequestException({
        message: `Archived ${bracket} ladders are per spec: give class and spec`,
      });
    }
  }

  private async currentBoard(
    query: LeaderboardQuery,
    seasons: PvpSeason[],
  ): Promise<LeaderboardResponse> {
    // On `world`, `$in` the regions: each index leads with season then region,
    // so the regions' ranges merge in rating order rather than being sorted.
    const filter: Filter<RatingRow> = { seasonId: query.seasonId, region: inRegions(seasons) };
    if (query.class) filter.class = query.class;
    if (query.spec) filter.spec = query.spec;

    const ratings = this.mongo.collection<RatingRow>(RATING_COLLECTIONS[query.bracket]);
    const [rows, total] = await Promise.all([
      ratings
        .find(filter, { projection: ROW_PROJECTION })
        .sort({ rating: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .toArray(),
      ratings.countDocuments(filter),
    ]);

    return this.response(query, seasons, total, await this.enricher.entriesAcross(rows, seasons));
  }

  private async archivedBoard(
    query: LeaderboardQuery,
    seasons: PvpSeason[],
  ): Promise<LeaderboardResponse> {
    const { seasonId, bracket, class: cls, spec } = query;
    // `assertArchivedFilters` has made sure a spec family names both.
    const ladder = isCore(bracket) ? bracket : `${bracket}-${cls}-${spec}`;
    const filter: Filter<ArchiveEntry> = { seasonId, region: inRegions(seasons), bracket: ladder };

    // `archive_board` (seasonId, region, bracket, rating desc) serves both.
    const archive = this.mongo.collection<ArchiveEntry>(Collections.ArchiveEntries);
    const [rows, total] = await Promise.all([
      archive
        .find(filter, { projection: ARCHIVE_PROJECTION })
        .sort({ rating: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .toArray(),
      archive.countDocuments(filter),
    ]);
    const seasonOf = new Map(seasons.map((season) => [season.region, season]));

    return this.response(
      query,
      seasons,
      total,
      rows.map((row) => archivedEntry(row, seasonOf.get(row.region) ?? null)),
    );
  }

  private response(
    query: LeaderboardQuery,
    seasons: PvpSeason[],
    total: number,
    entries: LeaderboardResponse['entries'],
  ): LeaderboardResponse {
    const response: LeaderboardResponse = {
      region: query.region,
      seasonId: query.seasonId,
      bracket: query.bracket,
      class: query.class,
      spec: query.spec,
      current: seasons[0]!.current,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      // One region's; on `world` there is none, as each region sets its own.
      cutoff: query.region === WORLD ? null : boardCutoff(query, seasons[0]!),
      entries,
    };
    if (query.region === WORLD) {
      response.regionCutoffs = Object.fromEntries(
        seasons.map((season) => [season.region, boardCutoff(query, season)]),
      );
    }

    return response;
  }
}

/** One region as an equality; several as `$in`, which the board indexes merge in order. */
function inRegions(seasons: readonly PvpSeason[]): Region | { $in: Region[] } {
  return seasons.length === 1
    ? seasons[0]!.region
    : { $in: seasons.map((season) => season.region) };
}

/**
 * The single cutoff that applies to a whole board, when there is one: a core
 * ladder, or one spec ladder. A board of several specs has one per spec.
 */
function boardCutoff(query: LeaderboardQuery, season: PvpSeason): Cutoff | null {
  if (isCore(query.bracket)) return season.cutoffs[query.bracket];
  if (query.class && query.spec) {
    return season.specCutoffs[query.bracket as SpecFamily][`${query.class}-${query.spec}`] ?? null;
  }

  return null;
}
