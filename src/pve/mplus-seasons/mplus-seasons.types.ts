/** One faction, or both together (`all`), at one cutoff. */
export interface MplusCutoffBand {
  /** The quantile reached, 0–1. */
  quantile: number | null;
  /** The lowest Mythic+ score that reaches the cutoff. */
  minScore: number | null;
  populationCount: number | null;
  populationFraction: number | null;
  totalPopulation: number | null;
}

export interface MplusCutoff {
  /** The title's own threshold (2000 for Keystone Master); null for the top-percent cutoffs. */
  score: number | null;
  alliance: MplusCutoffBand | null;
  horde: MplusCutoffBand | null;
  /** Both factions: the figure to show unless a faction is being compared. */
  all: MplusCutoffBand | null;
}

/** A season's cutoffs in one region, as Rankwarden stores them. */
export interface MplusRegionCutoffs {
  /** `ok`: read. `missing`: Raider.io has none. `failed` / `unavailable`: not read. */
  status: 'ok' | 'missing' | 'failed' | 'unavailable';
  /** Raider.io's own timestamp for the figures. */
  updatedAt: string | null;
  /** Title cutoffs, `keystoneExplorer` … `keystoneMyth`; a title the season did not award is absent. */
  keystones: Partial<Record<string, MplusCutoff>>;
  /** Top-percent cutoffs: `p999` (top 0.1%) and `p990` (top 1%). */
  quantiles: Partial<Record<string, MplusCutoff>>;
}

/**
 * A dungeon, as `mplus_dungeons` stores it. `slug` and `name` are null only for
 * a dungeon a season lists that the collection lacks, which no season does today.
 */
export interface MplusDungeon {
  id: number;
  slug: string | null;
  name: string | null;
  shortName: string | null;
  challengeModeId: number | null;
  keystoneTimerSeconds: number | null;
  iconUrl: string | null;
  backgroundImageUrl: string | null;
  /** Every expansion whose seasons ran it. */
  expansionIds: number[];
}

export interface MplusSeason {
  slug: string;
  name: string;
  shortName: string | null;
  /** Raider.io's expansion id: 10 = The War Within, 11 = Midnight. */
  expansionId: number;
  /** Blizzard's season id: 0 for all of Legion. */
  blizzardSeasonId: number | null;
  /** Per region, ISO 8601. */
  starts: Partial<Record<string, string>>;
  /** Per region; null while the season runs there (Raider.io's `2030-01-01` placeholder). */
  ends: Partial<Record<string, string | null>>;
  /**
   * The season's dungeons, in its own order, each from `mplus_dungeons`. A
   * dungeon the collection lacks keeps its `id` with every other field null.
   */
  dungeons: MplusDungeon[];
  /** Per region; empty for a season Rankwarden has no cutoffs for (before TWW 3). */
  cutoffs: Partial<Record<string, MplusRegionCutoffs>>;
}

/** A weekly affix, as `mplus_affixes` stores it. */
export interface MplusAffix {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  /** A game icon name, e.g. `ability_toughness`. */
  icon: string | null;
}

export interface MplusSeasonsResponse {
  /** Newest expansion first, then the latest to open within it. */
  seasons: MplusSeason[];
  /** Every affix Rankwarden has seen, by id. */
  affixes: MplusAffix[];
}
