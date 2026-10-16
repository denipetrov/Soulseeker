import { Injectable } from '@nestjs/common';

import type { Region } from '../blizzard/blizzard.constants.js';
import { Collections } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import type { RaiderIoRegion } from '../raiderio/raiderio.constants.js';

/** How long a read of the season state answers for. Seasons change a few times a year. */
const CACHE_MS = 60_000;

export interface PvpSeason {
  region: Region;
  seasonId: number;
}

export interface MplusSeason {
  region: RaiderIoRegion;
  season: string;
}

/**
 * The live season per region, as Rankwarden last recorded it in `season_state`
 * and `mplus_season_state`.
 *
 * The live collections hold one document per character per season, and for a
 * while after a rollover both the old and the new season are there, so every
 * live query filters on these. A season that has ended but not yet been
 * replaced is still the current one: Rankwarden keeps its ladders visible
 * until the next one starts.
 *
 * Held in memory briefly: these collections are a handful of documents read
 * on every search, and a rollover noticed a minute late shows nothing wrong.
 */
@Injectable()
export class CurrentSeasons {
  private pvp: { at: number; seasons: PvpSeason[] } | null = null;
  private mplus: { at: number; seasons: MplusSeason[] } | null = null;

  constructor(private readonly mongo: MongoService) {}

  async pvpSeasons(): Promise<PvpSeason[]> {
    if (this.pvp && Date.now() - this.pvp.at < CACHE_MS) return this.pvp.seasons;

    const seasons = await this.mongo
      .collection<PvpSeason>(Collections.SeasonState)
      .find({}, { projection: { _id: 0, region: 1, seasonId: 1 } })
      .toArray();

    this.pvp = { at: Date.now(), seasons };

    return seasons;
  }

  async mplusSeasons(): Promise<MplusSeason[]> {
    if (this.mplus && Date.now() - this.mplus.at < CACHE_MS) return this.mplus.seasons;

    const seasons = await this.mongo
      .collection<MplusSeason>(Collections.MplusSeasonState)
      .find({}, { projection: { _id: 0, region: 1, season: 1 } })
      .toArray();

    this.mplus = { at: Date.now(), seasons };

    return seasons;
  }
}
