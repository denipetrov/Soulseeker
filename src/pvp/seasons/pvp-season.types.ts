import type { Region } from '../../blizzard/blizzard.constants.js';

/** The ladders with one rating per character. */
export const CORE_BRACKETS = ['2v2', '3v3', 'rbg'] as const;
export type CoreBracket = (typeof CORE_BRACKETS)[number];

/** The ladders rated per specialisation: `shuffle-mage-fire`, `blitz-druid-feral`. */
export const SPEC_FAMILIES = ['shuffle', 'blitz'] as const;
export type SpecFamily = (typeof SPEC_FAMILIES)[number];

export type Faction = 'alliance' | 'horde';

export interface FactionCutoff {
  rating: number;
  title: string;
  achievementId: number;
}

/**
 * The rating a season's title took on one ladder.
 *
 * `rating` is the number to show. It is null only when Blizzard set a cutoff
 * per faction and the two differ — 3v3 and RBG up to season 33 — and then
 * `factions` holds both. `factions` is present whenever Blizzard split the
 * title by side (RBG and Blitz always), even when the two ratings agree,
 * because the titles differ ("Hero of the Alliance" / "Hero of the Horde").
 */
export interface Cutoff {
  rating: number | null;
  /** The title, when every faction shares it; null when they differ. */
  title: string | null;
  achievementId: number | null;
  factions: Partial<Record<Faction, FactionCutoff>> | null;
}

/** A cutoff on one spec's ladder. */
export interface SpecCutoff extends Cutoff {
  /** The full ladder name: `shuffle-mage-fire`. */
  bracket: string;
  specialization: { id: number; name: string } | null;
}

/**
 * One region's season, as cached: what a leaderboard needs to show the title
 * cutoffs, in the shape it looks them up by.
 *
 * - `cutoffs['3v3']` for the ladders with one cutoff for everyone; `2v2` is
 *   always null, as it awards no title.
 * - `specCutoffs.shuffle['mage-fire']` for the per-spec ladders, keyed by the
 *   ladder name without its family: `shuffle-mage-fire` → `mage-fire`.
 *
 * A season with no rewards recorded has nulls and empty maps, not gaps.
 */
export interface PvpSeason {
  region: Region;
  seasonId: number;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** The season `season_state` names as live for the region. */
  current: boolean;
  /** Cutoffs are final: taken from the archive, not from a season still moving. */
  final: boolean;
  rewardsFetchedAt: string | null;
  cutoffs: Record<CoreBracket, Cutoff | null>;
  specCutoffs: Record<SpecFamily, Record<string, SpecCutoff>>;
}

/** A season in a region's list, without its cutoffs. */
export interface PvpSeasonSummary {
  seasonId: number;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
  current: boolean;
  final: boolean;
}

/** Every region's seasons, newest first. The cache's index of what exists. */
export type PvpSeasonIndex = Partial<Record<Region, PvpSeasonSummary[]>>;
