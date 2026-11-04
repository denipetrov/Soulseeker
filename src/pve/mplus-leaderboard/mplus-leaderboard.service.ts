import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { MplusCharacterDocument } from '../../characters/entities/mplus-character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, Indexes } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CLASS_IDS, SPEC_IDS } from '../../pvp/specs.js';
import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';
import { CacheService } from '../../redis/cache.service.js';
import { CurrentSeasons } from '../../seasons/current-seasons.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import { CURRENT_SEASON, type MplusLeaderboardQuery } from './dto/mplus-leaderboard-query.dto.js';
import type { MplusLeaderboardEntry, MplusLeaderboardResponse } from './mplus-leaderboard.types.js';

const PROJECTION = {
  _id: 0,
  characterName: 1,
  realmName: 1,
  realmSlug: 1,
  region: 1,
  faction: 1,
  mythicScore: 1,
  profile: 1,
  dungeonRuns: 1,
} as const;

type Row = Pick<
  MplusCharacterDocument,
  | 'characterName'
  | 'realmName'
  | 'realmSlug'
  | 'region'
  | 'faction'
  | 'mythicScore'
  | 'profile'
  | 'dungeonRuns'
>;

/**
 * The Mythic+ character leaderboard, one page at a time, best `mythicScore`
 * first.
 *
 * - **Season.** `current` is the live season of the region, from
 *   `mplus_season_state`; on `world`, the newest season any region is on. That
 *   season is read from `mplus_characters`, any other from
 *   `mplus_archive_characters`. A season the catalogue does not know is a 404.
 * - **Filters** match the stored profile by Blizzard id — `profile.classId`,
 *   `profile.specId` — and `profile.role`. The slugs are the PvP endpoints'.
 * - **Reads** are hinted to the score-board index, so a page is an index walk
 *   in score order. On the live `world` board the region is spelled out as
 *   `$in` every region, so the per-region ranges of `mplus_score_board` merge
 *   in order rather than being sorted in memory. No index covers the profile:
 *   a filtered page reads documents along the board until it has a page.
 *
 * Pages are cached in Redis for `MPLUS_LEADERBOARD_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class MplusLeaderboardService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly currentSeasons: CurrentSeasons,
    private readonly catalogue: PveCatalogue,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_LEADERBOARD_CACHE_TTL_SECONDS', { infer: true });
  }

  async leaderboard(query: MplusLeaderboardQuery): Promise<MplusLeaderboardResponse> {
    const current = await this.currentSeason(query.region);
    const season = query.season === CURRENT_SEASON ? current : query.season;

    if (!season) {
      throw new NotFoundException({ message: 'No current Mythic+ season recorded' });
    }
    if (!(await this.catalogue.mplusSeason(season))) {
      throw new NotFoundException({ message: `No Mythic+ season ${season} in the catalogue` });
    }

    const key = [
      'pve:mplus-board',
      query.region,
      season,
      query.class ?? '-',
      query.spec ?? '-',
      query.role ?? '-',
      query.page,
      query.pageSize,
    ].join(':');

    const page = await this.cache.getOrLoad(
      key,
      () => this.page(query, season, season === current),
      this.cacheTtlSeconds,
    );

    return page!;
  }

  /** The live season of a region; on `world`, the newest any region is on. */
  private async currentSeason(region: string): Promise<string | null> {
    const states = await this.currentSeasons.mplusSeasons();
    if (region !== WORLD) return states.find((state) => state.region === region)?.season ?? null;

    const live = new Set(states.map((state) => state.season));
    // The catalogue lists seasons newest first.
    const newest = (await this.catalogue.mplusSeasons()).find((s) => live.has(s.slug));

    return newest?.slug ?? states[0]?.season ?? null;
  }

  private async page(
    query: MplusLeaderboardQuery,
    season: string,
    live: boolean,
  ): Promise<MplusLeaderboardResponse> {
    const filter: Filter<MplusCharacterDocument> = { season };
    if (query.region !== WORLD) {
      filter.region = query.region as MplusCharacterDocument['region'];
    } else if (live) {
      filter.region = { $in: [...RAIDERIO_REGIONS] };
    }
    if (query.class) filter['profile.classId'] = CLASS_IDS[query.class];
    if (query.class && query.spec)
      filter['profile.specId'] = SPEC_IDS[`${query.class}-${query.spec}`];
    if (query.role) filter['profile.role'] = query.role;

    const hint = live
      ? Indexes.MplusScoreBoard
      : query.region === WORLD
        ? Indexes.MplusArchiveScoreBoard
        : Indexes.MplusArchiveRegionScoreBoard;
    const collection = this.mongo.collection<MplusCharacterDocument>(
      live ? Collections.MplusCharacters : Collections.MplusArchiveCharacters,
    );
    const offset = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      collection
        .find(filter, { projection: PROJECTION, hint })
        .sort({ mythicScore: -1 })
        .skip(offset)
        .limit(query.pageSize)
        .toArray() as Promise<Row[]>,
      collection.countDocuments(filter, { hint }),
    ]);

    return {
      region: query.region,
      season,
      current: live,
      class: query.class,
      spec: query.spec,
      role: query.role,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      entries: rows.map((row, i) => entry(row, offset + i + 1)),
    };
  }
}

function entry(row: Row, rank: number): MplusLeaderboardEntry {
  return {
    rank,
    characterName: row.characterName,
    realmName: row.realmName ?? null,
    realmSlug: row.realmSlug,
    region: row.region,
    faction: row.faction ?? null,
    mythicScore: row.mythicScore,
    profile: row.profile,
    dungeonRuns: (row.dungeonRuns ?? []).map((run) => ({
      ...run,
      completedAt: new Date(run.completedAt).toISOString(),
    })),
  };
}
