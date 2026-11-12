import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Filter } from 'mongodb';

import type { MplusCharacterDocument } from '../../characters/entities/mplus-character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections, MplusBoardIndexes, type MplusBoardKind } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CLASS_IDS, SPEC_IDS } from '../../pvp/specs.js';
import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';
import { CacheService } from '../../redis/cache.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import { MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import type { MplusLeaderboardQuery } from './dto/mplus-leaderboard-query.dto.js';
import type { MplusLeaderboardEntry, MplusLeaderboardResponse } from './mplus-leaderboard.types.js';

const PROJECTION = {
  _id: 0,
  characterName: 1,
  realmName: 1,
  realmSlug: 1,
  region: 1,
  faction: 1,
  mythicScore: 1,
  previousMythicScore: 1,
  isFullyCovered: 1,
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
  | 'previousMythicScore'
  | 'isFullyCovered'
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
 * - **Reads** are hinted to Rankwarden's board index for the filter
 *   (`MplusBoardIndexes`), so a page is an index walk in score order: the
 *   spec board with a spec, else the class board with a class (a role beside
 *   it is checked on the documents), else the role board, else the score
 *   board. On the live `world` score board the region is spelled out as `$in`
 *   every region, so the per-region ranges of `mplus_score_board` merge in
 *   order rather than being sorted in memory.
 * - **Coverage.** Every character is listed; `isFullyCovered` says whether
 *   their runs cover every dungeon of the season, so `mythicScore` is whole.
 *
 * Pages are cached in Redis for `MPLUS_LEADERBOARD_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class MplusLeaderboardService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: MplusSeasonResolver,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_LEADERBOARD_CACHE_TTL_SECONDS', { infer: true });
  }

  async leaderboard(query: MplusLeaderboardQuery): Promise<MplusLeaderboardResponse> {
    const { slug: season, live } = await this.seasons.resolve(query.region, query.season);

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
      () => this.page(query, season, live),
      this.cacheTtlSeconds,
    );

    return page!;
  }

  private async page(
    query: MplusLeaderboardQuery,
    season: string,
    live: boolean,
  ): Promise<MplusLeaderboardResponse> {
    const kind: MplusBoardKind = query.spec
      ? 'spec'
      : query.class
        ? 'class'
        : query.role
          ? 'role'
          : 'score';
    const filter: Filter<MplusCharacterDocument> = { season };
    if (query.region !== WORLD) {
      filter.region = query.region as MplusCharacterDocument['region'];
    } else if (live && kind === 'score') {
      filter.region = { $in: [...RAIDERIO_REGIONS] };
    }
    if (query.class) filter['profile.classId'] = CLASS_IDS[query.class];
    if (query.class && query.spec)
      filter['profile.specId'] = SPEC_IDS[`${query.class}-${query.spec}`];
    if (query.role) filter['profile.role'] = query.role;

    const hint =
      MplusBoardIndexes[live ? 'live' : 'archive'][kind][
        query.region === WORLD ? 'world' : 'region'
      ];
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
    previousMythicScore: row.previousMythicScore ?? null,
    isFullyCovered: row.isFullyCovered ?? false,
    profile: row.profile,
    dungeonRuns: (row.dungeonRuns ?? []).map((run) => ({
      ...run,
      completedAt: new Date(run.completedAt).toISOString(),
    })),
  };
}
