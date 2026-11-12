import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import type { Env } from '../config/env.schema.js';
import { Collections } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import { CacheService } from '../redis/cache.service.js';

export interface RaidEncounter {
  id: number;
  slug: string;
  name: string;
}

/** A raid as the catalogue holds it: `nerubar-palace`, its name and its bosses in order. */
export interface CatalogueRaid {
  slug: string;
  name: string;
  /** `NP`; null where Raider.io gives none. */
  shortName: string | null;
  /** Raider.io's expansion id: 10 = The War Within, 11 = Midnight. */
  expansionId: number;
  /**
   * As Raider.io names it: an icon name (`inv_1215_raid_achievement_kithix`) or,
   * on some raids, a numeric file id (`8039569`). Null on every raid before
   * Battle for Azeroth.
   */
  icon: string | null;
  /** When the raid opened, per region (`us`, `eu`, `tw`, `kr`, `cn`), ISO 8601. */
  starts: Partial<Record<string, string>>;
  /**
   * When it closed, per region; null while it is still open (Raider.io's
   * `2030-01-01` placeholder).
   */
  ends: Partial<Record<string, string | null>>;
  encounters: RaidEncounter[];
}

/**
 * The lowest score in a region's top 0.1% and top 1% of a season, from
 * Raider.io's cutoffs as Rankwarden stores them. Null where none is recorded.
 */
export interface TopPercentCutoffs {
  p999: number | null;
  p990: number | null;
}

/** A Mythic+ season as the catalogue holds it: `season-mn-2`, its name and its dungeons. */
export interface CatalogueMplusSeason {
  slug: string;
  name: string;
  /** Raider.io dungeon ids, as `mplus_dungeons.id`. */
  dungeonIds: number[];
  expansionId: number;
  /** By region. They move through a live season; Rankwarden re-reads them every M+ pass. */
  cutoffs: Partial<Record<string, TopPercentCutoffs>>;
}

/** The catalogue's keys in Redis, under the cache prefix: one value each, for every replica. */
export const RAIDS_CACHE_KEY = 'pve:raids';
export const MPLUS_SEASONS_CACHE_KEY = 'pve:mplus-seasons';

interface RaidDocument extends Omit<CatalogueRaid, 'shortName' | 'icon' | 'starts' | 'ends'> {
  shortName?: string | null;
  icon?: string | null;
  starts?: Record<string, Date>;
  ends?: Record<string, Date>;
}

/** The end Raider.io gives a raid still open, until the real one is known. */
const OPEN_END = Date.UTC(2030, 0, 1);

export const isoDates = (dates: Record<string, Date> | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(dates ?? {}).map(([region, date]) => [region, new Date(date).toISOString()]),
  );

export const endDates = (dates: Record<string, Date> | undefined): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(dates ?? {}).map(([region, date]) => {
      const time = new Date(date).getTime();
      return [region, time === OPEN_END ? null : new Date(time).toISOString()];
    }),
  );

/** A quantile cutoff in `mplus_seasons.cutoffs.<region>.quantiles`; `all` is both factions. */
interface QuantileCutoff {
  all?: { minScore?: number | null } | null;
}

interface MplusSeasonDocument extends Omit<CatalogueMplusSeason, 'cutoffs'> {
  starts?: Record<string, Date>;
  cutoffs?: Record<string, { quantiles?: { p999?: QuantileCutoff; p990?: QuantileCutoff } }>;
}

const minScoreOf = (cutoff: QuantileCutoff | undefined): number | null =>
  cutoff?.all?.minScore ?? null;

/** The earliest start across regions, for ordering; 0 when none is recorded. */
function firstStart(starts: Record<string, Date> | undefined): number {
  const times = Object.values(starts ?? {}).map((date) => new Date(date).getTime());

  return times.length > 0 ? Math.min(...times) : 0;
}

/** Newest expansion first, then the latest to open within it. */
export const newestFirst = (
  a: { expansionId: number; starts?: Record<string, Date> },
  b: { expansionId: number; starts?: Record<string, Date> },
) => b.expansionId - a.expansionId || firstStart(b.starts) - firstStart(a.starts);

/**
 * Every raid and Mythic+ season Rankwarden catalogues, from `raids` and
 * `mplus_seasons`. Both are a few dozen small documents that change about once
 * a day.
 *
 * Each list is one value in Redis (`RAIDS_CACHE_KEY`, `MPLUS_SEASONS_CACHE_KEY`),
 * so every replica serves the same catalogue. Filled on demand: the first call
 * that finds a key missing reads Mongo and stores the list for
 * `PVE_CATALOGUE_TTL_SECONDS` (a day). Concurrent misses on one replica share
 * that read. If Redis is away, each call reads Mongo instead; if Mongo fails
 * too, the call fails.
 *
 * Only what the lookups and `GET /pve/raids` need is kept: slugs, names,
 * expansions, a raid's bosses, icon and regional dates, a season's dungeon ids
 * and its top 0.1% / 1% scores. Raid rankings, keystone-title cutoffs and
 * archive progress — most of the documents' size — are never read.
 */
@Injectable()
export class PveCatalogue {
  private readonly logger = new RunLogger(PveCatalogue.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('PVE_CATALOGUE_TTL_SECONDS', { infer: true });
  }

  /** Newest expansion first, then the latest to open within it. */
  async raids(): Promise<CatalogueRaid[]> {
    // Never null: the loader returns a list, empty at worst, or throws.
    return (await this.cache.getOrLoad(RAIDS_CACHE_KEY, () => this.loadRaids(), this.ttlSeconds))!;
  }

  /** Newest expansion first, then the latest to open within it. */
  async mplusSeasons(): Promise<CatalogueMplusSeason[]> {
    // Never null, as with the raids.
    return (await this.cache.getOrLoad(
      MPLUS_SEASONS_CACHE_KEY,
      () => this.loadSeasons(),
      this.ttlSeconds,
    ))!;
  }

  async raidSlugs(): Promise<string[]> {
    return (await this.raids()).map((raid) => raid.slug);
  }

  async mplusSeasonSlugs(): Promise<string[]> {
    return (await this.mplusSeasons()).map((season) => season.slug);
  }

  async raid(slug: string): Promise<CatalogueRaid | null> {
    return (await this.raids()).find((raid) => raid.slug === slug) ?? null;
  }

  /** The raids of the newest expansion that has any. */
  async currentExpansionRaids(): Promise<CatalogueRaid[]> {
    const raids = await this.raids();
    const newest = Math.max(...raids.map((raid) => raid.expansionId));

    return raids.filter((raid) => raid.expansionId === newest);
  }

  /**
   * The raid in progress: of the newest expansion's raids still open in some
   * region, the one with the most bosses — the tier's main raid, not a
   * one-boss raid that opened beside it. Between tiers, when none is open, the
   * newest expansion's raids are taken instead. A tie goes to the newer raid.
   * Null only with an empty catalogue.
   */
  async currentRaid(): Promise<CatalogueRaid | null> {
    const raids = await this.currentExpansionRaids();
    const open = raids.filter((raid) => Object.values(raid.ends).some((end) => end === null));
    const candidates = open.length > 0 ? open : raids;

    // Newest first already, so the first of the most bosses is the newer.
    return candidates.reduce<CatalogueRaid | null>(
      (best, raid) => (!best || raid.encounters.length > best.encounters.length ? raid : best),
      null,
    );
  }

  async mplusSeason(slug: string): Promise<CatalogueMplusSeason | null> {
    return (await this.mplusSeasons()).find((season) => season.slug === slug) ?? null;
  }

  private async loadRaids(): Promise<CatalogueRaid[]> {
    const raids = await this.mongo
      .collection<RaidDocument>(Collections.Raids)
      .find(
        {},
        {
          projection: {
            _id: 0,
            slug: 1,
            name: 1,
            shortName: 1,
            icon: 1,
            encounters: 1,
            expansionId: 1,
            starts: 1,
            ends: 1,
          },
        },
      )
      .toArray();

    this.logger.log(`Raids read: ${raids.length}, cached for ${this.ttlSeconds}s`);

    return raids.sort(newestFirst).map((raid) => ({
      slug: raid.slug,
      name: raid.name,
      shortName: raid.shortName ?? null,
      expansionId: raid.expansionId,
      icon: raid.icon ?? null,
      starts: isoDates(raid.starts),
      ends: endDates(raid.ends),
      encounters: (raid.encounters ?? []).map(({ id, slug, name }) => ({ id, slug, name })),
    }));
  }

  private async loadSeasons(): Promise<CatalogueMplusSeason[]> {
    const seasons = await this.mongo
      .collection<MplusSeasonDocument>(Collections.MplusSeasons)
      .find(
        {},
        {
          // The quantile cutoffs only: the keystone-title ones and fetch bookkeeping
          // next to them are not needed.
          projection: {
            _id: 0,
            slug: 1,
            name: 1,
            dungeonIds: 1,
            expansionId: 1,
            starts: 1,
            'cutoffs.us.quantiles': 1,
            'cutoffs.eu.quantiles': 1,
            'cutoffs.kr.quantiles': 1,
            'cutoffs.tw.quantiles': 1,
            'cutoffs.cn.quantiles': 1,
          },
        },
      )
      .toArray();

    this.logger.log(`Mythic+ seasons read: ${seasons.length}, cached for ${this.ttlSeconds}s`);

    return seasons.sort(newestFirst).map((season) => ({
      slug: season.slug,
      name: season.name,
      dungeonIds: season.dungeonIds ?? [],
      expansionId: season.expansionId,
      cutoffs: Object.fromEntries(
        Object.entries(season.cutoffs ?? {}).map(([region, cutoff]) => [
          region,
          {
            p999: minScoreOf(cutoff.quantiles?.p999),
            p990: minScoreOf(cutoff.quantiles?.p990),
          },
        ]),
      ),
    }));
  }
}
