import { Injectable, NotFoundException } from '@nestjs/common';

import { CurrentSeasons } from '../../seasons/current-seasons.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';

/** `season=current`: the live season, from `mplus_season_state`. */
export const CURRENT_SEASON = 'current';

/** A Mythic+ season a board is read for. */
export interface ResolvedMplusSeason {
  slug: string;
  /** The live season, read from the live collections; false for the archive. */
  live: boolean;
}

/**
 * Which Mythic+ season a board asks for, and whether it is live.
 *
 * `current` is the region's live season from `mplus_season_state`; on `world`,
 * the newest season any region is on, by the catalogue's order. That season is
 * live — read from `mplus_characters`, `mplus_runs` — and any other is read
 * from the archive. A slug the catalogue does not know, or `current` with no
 * season recorded, is a 404.
 */
@Injectable()
export class MplusSeasonResolver {
  constructor(
    private readonly currentSeasons: CurrentSeasons,
    private readonly catalogue: PveCatalogue,
  ) {}

  async resolve(region: string, season: string): Promise<ResolvedMplusSeason> {
    const current = await this.currentSeason(region);
    const slug = season === CURRENT_SEASON ? current : season;

    if (!slug) {
      throw new NotFoundException({ message: 'No current Mythic+ season recorded' });
    }
    if (!(await this.catalogue.mplusSeason(slug))) {
      throw new NotFoundException({ message: `No Mythic+ season ${slug} in the catalogue` });
    }

    return { slug, live: slug === current };
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
}
