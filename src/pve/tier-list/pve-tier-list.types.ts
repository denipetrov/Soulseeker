import type { TierListSpec } from '../../pvp/tier-list/tier-list.types.js';

/**
 * The Mythic+ tier list. Each spec has exactly the shape of the PvP one
 * (`TierListSpec`), so one front-end component draws both — `averageRating` is
 * the average Mythic+ score here.
 */
export interface PveTierListResponse {
  /** `world` or the region asked for. */
  region: string;
  /** The live season's slug. */
  season: string;
  seasonName: string | null;
  /** When this list was computed; it is reused for `TIER_LIST_CACHE_TTL_SECONDS`. */
  computedAt: string;
  /**
   * The score representation and average score count from: Keystone Master,
   * over fully covered characters only.
   */
  minScore: number;
  /** Characters the density read: the top 5,000 of the board, or all of a shorter one. */
  topRows: number;
  /** Of those, how many have a known spec. */
  topClassified: number;
  /** Fully covered characters at or above `minScore` with a known spec. */
  classified: number;
  /** Best first. */
  specs: TierListSpec[];
}
