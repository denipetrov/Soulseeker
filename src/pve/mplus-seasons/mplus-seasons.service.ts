import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { endDates, isoDates, newestFirst } from '../../seasons/pve-catalogue.service.js';
import type {
  MplusAffix,
  MplusDungeon,
  MplusRegionCutoffs,
  MplusSeasonsResponse,
} from './mplus-seasons.types.js';

/**
 * The answer's key in Redis, under the cache prefix: one value for every
 * replica. Not `pve:mplus-seasons`, which is the catalogue's slim season list
 * (`PveCatalogue`): sharing it would serve each the other's shape.
 */
export const MPLUS_SEASON_LIST_CACHE_KEY = 'pve:mplus-season-list';

interface StoredCutoffs extends Omit<MplusRegionCutoffs, 'updatedAt'> {
  updatedAt: Date | null;
}

interface SeasonDocument {
  slug: string;
  name: string;
  shortName?: string | null;
  expansionId: number;
  blizzardSeasonId?: number | null;
  starts?: Record<string, Date>;
  ends?: Record<string, Date>;
  dungeonIds?: number[];
  cutoffs?: Record<string, StoredCutoffs>;
}

const DUNGEON_PROJECTION = {
  _id: 0,
  id: 1,
  slug: 1,
  name: 1,
  shortName: 1,
  challengeModeId: 1,
  keystoneTimerSeconds: 1,
  iconUrl: 1,
  backgroundImageUrl: 1,
  expansionIds: 1,
} as const;

const missingDungeon = (id: number): MplusDungeon => ({
  id,
  slug: null,
  name: null,
  shortName: null,
  challengeModeId: null,
  keystoneTimerSeconds: null,
  iconUrl: null,
  backgroundImageUrl: null,
  expansionIds: [],
});

/**
 * Every Mythic+ season Rankwarden catalogues, each with its dungeons and
 * cutoffs, and every affix: three small collections, read whole.
 *
 * - **Seasons** from `mplus_seasons`, newest first, without the archive marker
 *   (Rankwarden's bookkeeping). The `2030-01-01` end of a running season is
 *   null, as on `GET /pve/raids`.
 * - **Dungeons** from `mplus_dungeons`, in place of each season's `dungeonIds`,
 *   in the season's order. A dungeon runs in several seasons, so it is
 *   repeated in each; the answer stays ~95 KB before compression.
 * - **Cutoffs** per region as stored, less the fetch bookkeeping (`fetchedAt`,
 *   `attempts`, `finalised`).
 * - **Affixes** from `mplus_affixes`, by id. They are not linked to seasons.
 *
 * The whole answer is one value in Redis, filled on demand and kept for
 * `MPLUS_SEASONS_CACHE_TTL_SECONDS`: the cutoffs of a live season move with
 * every Rankwarden pass.
 */
@Injectable()
export class MplusSeasonsService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('MPLUS_SEASONS_CACHE_TTL_SECONDS', { infer: true });
  }

  async seasons(): Promise<MplusSeasonsResponse> {
    const response = await this.cache.getOrLoad(
      MPLUS_SEASON_LIST_CACHE_KEY,
      () => this.load(),
      this.cacheTtlSeconds,
    );

    return response!;
  }

  /**
   * A dungeon of a season, by slug, or a 404: the check every board filtered
   * to one dungeon makes, so a dungeon the season does not run is refused alike.
   */
  async dungeon(season: string, slug: string): Promise<MplusDungeon> {
    const { seasons } = await this.seasons();
    const dungeon = seasons
      .find((entry) => entry.slug === season)
      ?.dungeons.find((entry) => entry.slug === slug);
    if (!dungeon) {
      throw new NotFoundException({ message: `No dungeon ${slug} in ${season}` });
    }

    return dungeon;
  }

  private async load(): Promise<MplusSeasonsResponse> {
    const [seasons, dungeons, affixes] = await Promise.all([
      this.mongo
        .collection<SeasonDocument>(Collections.MplusSeasons)
        .find(
          {},
          {
            projection: {
              _id: 0,
              slug: 1,
              name: 1,
              shortName: 1,
              expansionId: 1,
              blizzardSeasonId: 1,
              starts: 1,
              ends: 1,
              dungeonIds: 1,
              cutoffs: 1,
            },
          },
        )
        .toArray(),
      this.mongo
        .collection<MplusDungeon>(Collections.MplusDungeons)
        .find({}, { projection: DUNGEON_PROJECTION })
        .toArray(),
      this.mongo
        .collection<MplusAffix>(Collections.MplusAffixes)
        .find({}, { projection: { _id: 0, id: 1, name: 1, slug: 1, description: 1, icon: 1 } })
        .sort({ id: 1 })
        .toArray(),
    ]);

    const dungeonById = new Map(dungeons.map((dungeon) => [dungeon.id, dungeon]));

    return {
      seasons: seasons.sort(newestFirst).map((season) => ({
        slug: season.slug,
        name: season.name,
        shortName: season.shortName ?? null,
        expansionId: season.expansionId,
        blizzardSeasonId: season.blizzardSeasonId ?? null,
        starts: isoDates(season.starts),
        ends: endDates(season.ends),
        dungeons: (season.dungeonIds ?? []).map((id) => dungeonById.get(id) ?? missingDungeon(id)),
        cutoffs: Object.fromEntries(
          Object.entries(season.cutoffs ?? {}).map(([region, cutoff]) => [
            region,
            {
              status: cutoff.status,
              updatedAt: cutoff.updatedAt ? new Date(cutoff.updatedAt).toISOString() : null,
              keystones: cutoff.keystones ?? {},
              quantiles: cutoff.quantiles ?? {},
            },
          ]),
        ),
      })),
      affixes: affixes.map((affix) => ({
        id: affix.id,
        name: affix.name,
        slug: affix.slug ?? null,
        description: affix.description ?? null,
        icon: affix.icon ?? null,
      })),
    };
  }
}
