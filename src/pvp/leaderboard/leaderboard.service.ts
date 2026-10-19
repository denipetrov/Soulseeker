import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { ArchiveEntry, RatingRow } from '../../characters/entities/character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, type ReadCollection } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import {
  CORE_BRACKETS,
  type CoreBracket,
  type Cutoff,
  type PvpSeason,
  type SpecFamily,
} from '../seasons/pvp-season.types.js';
import type { LeaderboardBracket, LeaderboardQuery } from './dto/leaderboard-query.dto.js';
import { archivedEntry, currentEntry, type BoardCharacter } from './leaderboard.mapper.js';
import type { LeaderboardResponse } from './leaderboard.types.js';

/** The flat ratings collection each ladder family lives in. */
const RATING_COLLECTIONS: Record<LeaderboardBracket, ReadCollection> = {
  '2v2': Collections.Ratings2v2,
  '3v3': Collections.Ratings3v3,
  rbg: Collections.RatingsRbg,
  shuffle: Collections.RatingsShuffle,
  blitz: Collections.RatingsBlitz,
};

const ROW_PROJECTION = {
  _id: 0,
  characterId: 1,
  bracket: 1,
  rating: 1,
  class: 1,
  spec: 1,
} as const;

/** What enrichment needs of a profile, and nothing else: talent codes are kilobytes. */
const PROFILE_PROJECTION = {
  'profile.class.name': 1,
  'profile.spec.name': 1,
  'profile.heroTalentTree.name': 1,
  'profile.talentLoadouts.spec.name': 1,
  'profile.talentLoadouts.heroTalentTree.name': 1,
  'profile.gender': 1,
  'profile.level': 1,
  'profile.race.name': 1,
} as const;

const ARCHIVE_PROJECTION = {
  _id: 0,
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
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('LEADERBOARD_CACHE_TTL_SECONDS', { infer: true });
  }

  async leaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse> {
    const season = await this.seasons.season(query.region, query.seasonId);
    if (!season) {
      throw new NotFoundException({
        message: `No PvP season ${query.seasonId} in ${query.region}`,
      });
    }

    if (!season.current) this.assertArchivedFilters(query);

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
      () => (season.current ? this.currentBoard(query, season) : this.archivedBoard(query, season)),
      this.cacheTtlSeconds,
    );

    return page!;
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
    season: PvpSeason,
  ): Promise<LeaderboardResponse> {
    const { region, seasonId } = query;
    const filter: Filter<RatingRow> = { seasonId, region };
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

    const characters = await this.charactersOf(rows, season);
    const entries = rows.map((row) => currentEntry(row, characters.get(row.characterId), season));

    return this.response(query, season, total, entries);
  }

  /** The characters of a page of rows, in one read, with only the ladders the page shows. */
  private async charactersOf(
    rows: readonly Pick<RatingRow, 'characterId' | 'bracket'>[],
    season: PvpSeason,
  ): Promise<Map<number, BoardCharacter>> {
    if (rows.length === 0) return new Map();

    const projection: Record<string, 0 | 1> = {
      _id: 0,
      characterId: 1,
      characterName: 1,
      realmSlug: 1,
      faction: 1,
      profileStatus: 1,
      ...PROFILE_PROJECTION,
    };
    for (const bracket of new Set(rows.map((row) => row.bracket))) {
      projection[`brackets.${bracket}`] = 1;
    }

    const docs = await this.mongo
      .collection<BoardCharacter & { seasonId: number; region: string }>(Collections.Characters)
      .find(
        {
          seasonId: season.seasonId,
          region: season.region,
          characterId: { $in: rows.map((row) => row.characterId) },
        },
        { projection },
      )
      .toArray();

    return new Map(docs.map((doc) => [doc.characterId, doc as BoardCharacter]));
  }

  private async archivedBoard(
    query: LeaderboardQuery,
    season: PvpSeason,
  ): Promise<LeaderboardResponse> {
    const { region, seasonId, bracket, class: cls, spec } = query;
    // `assertArchivedFilters` has made sure a spec family names both.
    const ladder = isCore(bracket) ? bracket : `${bracket}-${cls}-${spec}`;
    const filter: Filter<ArchiveEntry> = { seasonId, region, bracket: ladder };

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

    return this.response(
      query,
      season,
      total,
      rows.map((row) => archivedEntry(row, season)),
    );
  }

  private response(
    query: LeaderboardQuery,
    season: PvpSeason,
    total: number,
    entries: LeaderboardResponse['entries'],
  ): LeaderboardResponse {
    return {
      region: query.region,
      seasonId: query.seasonId,
      bracket: query.bracket,
      class: query.class,
      spec: query.spec,
      current: season.current,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      cutoff: boardCutoff(query, season),
      entries,
    };
  }
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
