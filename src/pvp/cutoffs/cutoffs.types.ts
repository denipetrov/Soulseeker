import type { Region } from '../../blizzard/blizzard.constants.js';
import type { LeaderboardEntry } from '../leaderboard/leaderboard.types.js';
import type { Cutoff } from '../seasons/pvp-season.types.js';
import type { CutoffBracket } from './dto/cutoffs-query.dto.js';

/**
 * How many characters of one spec are at or above the title cutoff.
 *
 * On Shuffle and Blitz each spec has its own ladder and its own cutoff, given
 * here with its title. On 3v3 and RBG every spec shares the season's one
 * cutoff, which is the response's `cutoff`, and `class` and `spec` are the
 * character's active spec — null for characters Rankwarden has not enriched
 * yet, who are counted together in one entry.
 */
export interface SpecCutoffCount {
  class: string | null;
  spec: string | null;
  count: number;
  /** Shuffle and Blitz only: this spec's own cutoff. */
  cutoff?: SpecLadderCutoff;
}

export interface SpecLadderCutoff extends Cutoff {
  /** The spec's ladder: `shuffle-mage-fire`. */
  bracket: string;
}

export interface CutoffsResponse {
  region: Region;
  bracket: CutoffBracket;
  seasonId: number;
  /** As Blizzard names it: `Player vs. Player (Midnight Season 2)`. */
  seasonName: string | null;
  /**
   * Cutoffs move until the season ends and are read by Rankwarden from
   * Blizzard; false until they are the final, archived ones.
   */
  final: boolean;
  /** When Rankwarden last read the cutoffs from Blizzard. */
  rewardsFetchedAt: string | null;
  /** 3v3 and RBG: the one cutoff, with its title. Null on Shuffle and Blitz, which have one per spec. */
  cutoff: Cutoff | null;
  /** Characters at or above the cutoff, across every spec. */
  total: number;
  /** Most characters first. */
  specs: SpecCutoffCount[];
}

/**
 * With `class` and `spec`: the characters of that spec who reach the cutoff,
 * best first, in the leaderboard's entry shape. Not paged: a title cutoff is
 * the top fraction of a percent of a ladder, a few dozen characters a spec.
 */
export interface CutoffCharactersResponse {
  region: Region;
  bracket: CutoffBracket;
  class: string;
  spec: string;
  seasonId: number;
  seasonName: string | null;
  final: boolean;
  rewardsFetchedAt: string | null;
  /** The cutoff counted against: the spec's own on Shuffle and Blitz, the season's on 3v3 and RBG. */
  cutoff: Cutoff | SpecLadderCutoff;
  /** How many characters `characters` holds. */
  total: number;
  characters: LeaderboardEntry[];
}
