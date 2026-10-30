import type { Region } from '../../blizzard/blizzard.constants.js';

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

/** One spec's place on a tier list, with what each factor gave it. */
export interface TierListSpec {
  /** Slugs, as on the ladders: `warrior`, `arms`. */
  class: string;
  spec: string;
  tier: Tier;
  /** 0–100: the three factors' points added up. Specs are ordered by it. */
  score: number;
  /**
   * How many of the ladder's top 250, 500, 1,000, 2,500 and 5,000 rows are
   * this spec. `score` is out of 45.
   */
  topDensity: {
    top250: number;
    top500: number;
    top1000: number;
    top2500: number;
    top5000: number;
    score: number;
  };
  /** Rows at or above `minRating`; `share` of the list's `classified`. `score` is out of 35. */
  representation: { count: number; share: number; score: number };
  /**
   * `value` is the mean rating of those rows; `adjusted` is that mean taken
   * with 50 more players at `minRating`, so a spec of few players counts for
   * less. `score` — out of 20 — goes by `adjusted`. Both null for a spec with
   * no row at or above `minRating`.
   */
  averageRating: { value: number | null; adjusted: number | null; score: number };
}

export interface TierListResponse {
  region: Region;
  bracket: string;
  seasonId: number;
  seasonName: string | null;
  /** When this list was computed; it is reused for `TIER_LIST_CACHE_TTL_SECONDS`. */
  computedAt: string;
  /** The rating representation and average rating count from. */
  minRating: number;
  /** Rows the density read: the top 5,000, or the whole ladder when shorter. */
  topRows: number;
  /** Of those, how many have a known spec. */
  topClassified: number;
  /** Rows at or above `minRating` with a known spec. */
  classified: number;
  /** Best first. */
  specs: TierListSpec[];
}
