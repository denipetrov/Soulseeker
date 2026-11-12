/** A dungeon as a run carries it. */
export interface MplusRunDungeon {
  id: number;
  name: string;
  slug: string;
  shortName: string | null;
}

/** One member of the party, as Rankwarden stores it. */
export interface MplusRunMember {
  /** Raider.io's character id, not Blizzard's; 0 for an anonymised player. */
  rioCharacterId: number;
  characterName: string;
  realmSlug: string;
  realmId: number | null;
  region: string;
  classId: number;
  className: string;
  specId: number | null;
  specName: string | null;
  role: string;
  faction: string | null;
  /** The player opted out of public profiles. */
  anonymized: boolean;
}

/** One timed run on the board, as Rankwarden stores it. */
export interface MplusRun {
  /** Place on this board (region, season, dungeon): page offset plus position. */
  rank: number;
  keystoneRunId: number;
  region: string;
  score: number;
  dungeon: MplusRunDungeon;
  mythicLevel: number;
  clearTimeMs: number;
  /** The dungeon's par time for the run. */
  keystoneTimeMs: number | null;
  /** By how much the run was timed. */
  timeRemainingMs: number | null;
  /** Keystone upgrades: 1, 2 or 3. */
  numChests: number | null;
  /** ISO 8601. */
  completedAt: string;
  /** Affix ids; `GET /pve/mplus-seasons` lists them in full. */
  affixIds: number[];
  faction: string | null;
  roster: MplusRunMember[];
}

export interface MplusRunsResponse {
  /** `world` or the region asked for. */
  region: string;
  /** The season slug answered: `current` resolved. */
  season: string;
  /** Read from the live collection; false for an archived season. */
  current: boolean;
  /** The dungeon slug asked for, or null for every dungeon. */
  dungeon: string | null;
  page: number;
  pageSize: number;
  total: number;
  /**
   * Pages there are, up to the deepest page that can be asked for: a board
   * deeper than 200,000 runs (the live `world` board holds ~800,000) is paged
   * only that far.
   */
  totalPages: number;
  runs: MplusRun[];
}
