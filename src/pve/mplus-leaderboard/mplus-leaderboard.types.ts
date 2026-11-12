import type {
  DungeonRun,
  MplusCharacterDocument,
} from '../../characters/entities/mplus-character.entity.js';

/** One character on the board, as Rankwarden stores it. */
export interface MplusLeaderboardEntry {
  /** Place on this board, filters included: page offset plus position. */
  rank: number;
  characterName: string;
  realmName: string | null;
  realmSlug: string;
  region: string;
  faction: string | null;
  mythicScore: number;
  /**
   * `mythicScore` before Rankwarden's latest write: equal to it when the
   * character gained nothing, lower when they climbed. Null on a character's
   * first write, and always on an archived season.
   */
  previousMythicScore: number | null;
  /**
   * Whether the stored runs cover every dungeon of the season. When false,
   * `mythicScore` is a partial sum: some dungeons' runs sit below what
   * Rankwarden reads, so the character may rank lower than their real score.
   */
  isFullyCovered: boolean;
  profile: MplusCharacterDocument['profile'];
  /**
   * The best run per dungeon, highest score first, as stored (`completedAt`
   * as an ISO string). Dungeons by id; `GET` them separately for their art.
   */
  dungeonRuns: (Omit<DungeonRun, 'completedAt'> & { completedAt: string })[];
}

export interface MplusLeaderboardResponse {
  /** `world` or the region asked for. */
  region: string;
  /** The season slug answered: `current` resolved. */
  season: string;
  /** Read from the live collection; false for an archived season. */
  current: boolean;
  class: string | null;
  spec: string | null;
  role: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  entries: MplusLeaderboardEntry[];
}
