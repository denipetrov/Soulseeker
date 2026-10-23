import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { describeError } from '../common/utils/errors.js';
import type { Env } from '../config/env.schema.js';
import { Collections } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';

export interface RaidEncounter {
  id: number;
  slug: string;
  name: string;
}

/** A raid as the catalogue holds it: `nerubar-palace`, its name and its bosses in order. */
export interface CatalogueRaid {
  slug: string;
  name: string;
  /** Raider.io's expansion id: 10 = The War Within, 11 = Midnight. */
  expansionId: number;
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

export interface PveCatalogueSnapshot {
  /** Newest first. */
  raids: CatalogueRaid[];
  /** Newest first. */
  mplusSeasons: CatalogueMplusSeason[];
  loadedAt: string;
}

interface RaidDocument extends CatalogueRaid {
  expansionId: number;
  starts?: Record<string, Date>;
}

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
const newestFirst = (
  a: { expansionId: number; starts?: Record<string, Date> },
  b: { expansionId: number; starts?: Record<string, Date> },
) => b.expansionId - a.expansionId || firstStart(b.starts) - firstStart(a.starts);

/**
 * Every raid and Mythic+ season Rankwarden catalogues, from `raids` and
 * `mplus_seasons`, held in memory.
 *
 * Both are a few dozen small documents that change about once a day, so they
 * are read at startup and again once `PVE_CATALOGUE_TTL_SECONDS` (a day) has
 * passed, on the next call. A failed read keeps the previous catalogue and is
 * retried on the next call; only a replica that has never read one fails.
 *
 * Only what character lookups need is kept: slugs, names, expansions, a raid's
 * bosses, a season's dungeon ids and its top 0.1% / 1% scores. Raid rankings,
 * keystone-title cutoffs and archive progress — most of the documents' size —
 * are never read.
 */
@Injectable()
export class PveCatalogue implements OnApplicationBootstrap {
  private readonly logger = new RunLogger(PveCatalogue.name);
  private readonly ttlMs: number;
  private snapshot: PveCatalogueSnapshot | null = null;
  private loadedAtMs = 0;
  /** One reload at a time on this replica. */
  private loading: Promise<PveCatalogueSnapshot> | null = null;

  constructor(
    private readonly mongo: MongoService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('PVE_CATALOGUE_TTL_SECONDS', { infer: true }) * 1000;
  }

  /** Loads at startup so the first lookup does not pay for it; a failure here is retried later. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.catalogue();
    } catch (error) {
      this.logger.error(`PvE catalogue not loaded at startup: ${describeError(error)}`);
    }
  }

  async catalogue(): Promise<PveCatalogueSnapshot> {
    if (this.snapshot && Date.now() - this.loadedAtMs < this.ttlMs) return this.snapshot;

    this.loading ??= this.load()
      .catch((error: unknown) => {
        if (!this.snapshot) throw error;

        this.logger.warn(
          `PvE catalogue reload failed, keeping the last one: ${describeError(error)}`,
        );
        return this.snapshot;
      })
      .finally(() => {
        this.loading = null;
      });

    return this.loading;
  }

  async raids(): Promise<CatalogueRaid[]> {
    return (await this.catalogue()).raids;
  }

  async mplusSeasons(): Promise<CatalogueMplusSeason[]> {
    return (await this.catalogue()).mplusSeasons;
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

  async mplusSeason(slug: string): Promise<CatalogueMplusSeason | null> {
    return (await this.mplusSeasons()).find((season) => season.slug === slug) ?? null;
  }

  private async load(): Promise<PveCatalogueSnapshot> {
    const [raids, seasons] = await Promise.all([
      this.mongo
        .collection<RaidDocument>(Collections.Raids)
        .find(
          {},
          {
            projection: { _id: 0, slug: 1, name: 1, encounters: 1, expansionId: 1, starts: 1 },
          },
        )
        .toArray(),
      this.mongo
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
        .toArray(),
    ]);

    const loadedAt = new Date();
    const snapshot: PveCatalogueSnapshot = {
      raids: raids.sort(newestFirst).map((raid) => ({
        slug: raid.slug,
        name: raid.name,
        expansionId: raid.expansionId,
        encounters: (raid.encounters ?? []).map(({ id, slug, name }) => ({ id, slug, name })),
      })),
      mplusSeasons: seasons.sort(newestFirst).map((season) => ({
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
      })),
      loadedAt: loadedAt.toISOString(),
    };

    this.snapshot = snapshot;
    this.loadedAtMs = loadedAt.getTime();
    this.logger.log(
      `PvE catalogue loaded: ${snapshot.raids.length} raids, ` +
        `${snapshot.mplusSeasons.length} Mythic+ seasons, for ${this.ttlMs / 1000}s`,
    );

    return snapshot;
  }
}
