import type { Region } from '../../blizzard/blizzard.constants.js';
import type { Cutoff } from '../seasons/pvp-season.types.js';
import type { LeaderboardBracket } from './dto/leaderboard-query.dto.js';

/**
 * One row of a leaderboard.
 *
 * The first block is always present, though any of it may be null while
 * Rankwarden has not finished with the character. The second is filled for
 * the current season only — archived rows carry no profile — and is absent
 * from archived rows rather than null.
 */
export interface LeaderboardEntry {
  characterId: number;
  characterName: string | null;
  realmSlug: string | null;
  /** The ladder the row is on: `3v3`, or `shuffle-mage-fire` on a Shuffle board. */
  bracket: string;
  rating: number;
  /** Blizzard's rank on that ladder; on an all-specs board it is the rank within the spec. */
  rank: number | null;
  played: number | null;
  won: number | null;
  lost: number | null;
  /** Lowercase: `alliance` or `horde`. */
  faction: string | null;
  /** The rating reaches the season's title cutoff for this ladder (and faction, where split). */
  inTitleRange: boolean;

  class?: string | null;
  spec?: string | null;
  gender?: string | null;
  heroTalents?: string | null;
  level?: number | null;
  profileStatus?: string | null;
  race?: string | null;
}

export interface LeaderboardResponse {
  region: Region;
  seasonId: number;
  bracket: LeaderboardBracket;
  class: string | null;
  spec: string | null;
  /** Served from the live ratings (true) or from the season's archive (false). */
  current: boolean;
  /** 1-based. A page past the last one answers with no entries, not an error. */
  page: number;
  pageSize: number;
  /** Rows on the whole board, across every page. */
  total: number;
  totalPages: number;
  /**
   * The board's title cutoff. Null on 2v2 (no title), on a Shuffle or Blitz
   * board covering several specs (each spec has its own: see `inTitleRange`),
   * and for a season with no rewards recorded.
   */
  cutoff: Cutoff | null;
  entries: LeaderboardEntry[];
}
