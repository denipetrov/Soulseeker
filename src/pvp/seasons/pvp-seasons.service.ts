import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import type { Region } from '../../blizzard/blizzard.constants.js';
import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import type { ArchiveSeasonDocument, SeasonStateDocument } from '../entities/season.entity.js';
import { buildSeasons, cutoffOf, indexOf, seasonKeyOf } from './pvp-season.mapper.js';
import type {
  Cutoff,
  PvpSeason,
  PvpSeasonIndex,
  PvpSeasonSummary,
  SpecCutoff,
} from './pvp-season.types.js';

/** The list of every region's seasons. */
const INDEX_KEY = 'pvp:seasons';
/** One region's season with its cutoffs: `pvp:season:eu:42`. */
const seasonCacheKey = (region: Region, seasonId: number) =>
  `pvp:season:${seasonKeyOf(region, seasonId)}`;

/** Only what a season needs: never the archive's progress fields. */
const SEASON_PROJECTION = {
  _id: 0,
  region: 1,
  seasonId: 1,
  name: 1,
  startsAt: 1,
  endsAt: 1,
  rewards: 1,
  rewardsFetchedAt: 1,
} as const;

/**
 * PvP seasons and their title cutoffs, live and archived, from Redis.
 *
 * The cache holds one entry per region and season (`pvp:season:<region>:<id>`),
 * so a leaderboard reads exactly the season it shows, about 15 KB, and an
 * index of every region's seasons (`pvp:seasons`). All of them are written
 * together, in one transaction with one TTL (`PVP_SEASONS_CACHE_TTL_SECONDS`,
 * an hour), so they expire together.
 *
 * On a miss both collections are read whole — about 60 documents — and the
 * cache refilled: one load answers every season of every region for the next
 * hour. The index tells a miss from a season that does not exist, so asking
 * for an unknown season costs a Redis read, not a Mongo one.
 */
@Injectable()
export class PvpSeasonsService {
  private readonly logger = new RunLogger(PvpSeasonsService.name);
  private readonly ttlSeconds: number;
  /** One reload at a time on this replica. */
  private reloading: Promise<PvpSeason[]> | null = null;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('PVP_SEASONS_CACHE_TTL_SECONDS', { infer: true });
  }

  /** One region's season with its cutoffs, or null when there is no such season. */
  async season(region: Region, seasonId: number): Promise<PvpSeason | null> {
    const [index, cached] = await this.cache.getMany<PvpSeasonIndex | PvpSeason>([
      INDEX_KEY,
      seasonCacheKey(region, seasonId),
    ]);

    if (cached) return cached as PvpSeason;

    // A warm index that does not list the season: it does not exist.
    const listed = (index as PvpSeasonIndex | null)?.[region]?.some(
      (summary) => summary.seasonId === seasonId,
    );
    if (index && !listed) return null;

    const seasons = await this.reload();

    return seasons.find((s) => s.region === region && s.seasonId === seasonId) ?? null;
  }

  /** The region's live season, or null when Rankwarden has not recorded one. */
  async currentSeason(region: Region): Promise<PvpSeason | null> {
    const current = (await this.seasons(region)).find((summary) => summary.current);

    return current ? this.season(region, current.seasonId) : null;
  }

  /** One region's seasons, newest first, without their cutoffs. */
  async seasons(region: Region): Promise<PvpSeasonSummary[]> {
    const index = (await this.cache.get<PvpSeasonIndex>(INDEX_KEY)) ?? indexOf(await this.reload());

    return index[region] ?? [];
  }

  /**
   * The cutoff of one ladder in one season, by ladder name: `3v3`, `rbg`,
   * `shuffle-mage-fire`. Null for 2v2, for a season or ladder without one.
   */
  async cutoff(
    region: Region,
    seasonId: number,
    bracket: string,
  ): Promise<Cutoff | SpecCutoff | null> {
    const season = await this.season(region, seasonId);

    return season ? cutoffOf(season, bracket) : null;
  }

  /** Reads both collections and refills the whole cache. */
  private reload(): Promise<PvpSeason[]> {
    this.reloading ??= this.load().finally(() => {
      this.reloading = null;
    });

    return this.reloading;
  }

  private async load(): Promise<PvpSeason[]> {
    const [archived, live] = await Promise.all([
      this.mongo
        .collection<ArchiveSeasonDocument>(Collections.ArchiveSeasons)
        .find({}, { projection: SEASON_PROJECTION })
        .toArray(),
      this.mongo
        .collection<SeasonStateDocument>(Collections.SeasonState)
        .find({}, { projection: SEASON_PROJECTION })
        .toArray(),
    ]);

    const seasons = buildSeasons(archived, live);
    const entries = new Map<string, unknown>([[INDEX_KEY, indexOf(seasons)]]);
    for (const season of seasons) {
      entries.set(seasonCacheKey(season.region, season.seasonId), season);
    }

    await this.cache.setMany(entries, this.ttlSeconds);
    this.logger.log(
      `PvP seasons cached: ${seasons.length} seasons (${live.length} live) for ${this.ttlSeconds}s`,
    );

    return seasons;
  }
}
