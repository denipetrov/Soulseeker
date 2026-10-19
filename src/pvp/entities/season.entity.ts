import type { Region } from '../../blizzard/blizzard.constants.js';

/**
 * One title Blizzard awarded for a season, and the rating it took.
 *
 * Per ladder, and per faction where the title differs by side: RBG and Blitz
 * always come in an Alliance and a Horde entry; 3v3 did too up to season 33.
 * Solo Shuffle and Blitz entries carry the spec they were awarded for. 2v2 has
 * no title, so it never appears.
 */
export interface SeasonReward {
  /** `3v3`, `rbg`, `shuffle-mage-fire`, `blitz-deathknight-blood`. */
  bracket: string;
  faction: 'ALLIANCE' | 'HORDE' | null;
  ratingCutoff: number;
  title: string;
  achievementId: number;
  specialization: { id: number; name: string } | null;
}

/** A document in Rankwarden's `season_state`: the live PvP season of one region. */
export interface SeasonStateDocument {
  region: Region;
  seasonId: number;
  name?: string;
  startsAt: Date;
  /** Null while the season runs. */
  endsAt: Date | null;
  lastCompletedSeasonId: number | null;
  observedAt: Date;
  /** The live season's cutoffs, which move until it ends. */
  rewards?: SeasonReward[];
  rewardsFetchedAt?: Date;
}

/** A document in Rankwarden's `archive_seasons`: a finished season of one region. */
export interface ArchiveSeasonDocument {
  region: Region;
  seasonId: number;
  name?: string;
  startsAt: Date | null;
  endsAt: Date | null;
  archivedAt: Date;
  /** The cutoffs the titles were finally awarded at. */
  rewards?: SeasonReward[];
  rewardsFetchedAt?: Date;
  unarchivable?: boolean;
}
