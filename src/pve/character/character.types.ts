import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';

/** Raider.io's base profile, sent with every answer whatever was asked. */
export interface PveCharacterBase {
  name: string;
  race: string;
  class: string;
  activeSpecName: string | null;
  /** As Raider.io spells it: `DPS`, `HEALING`, `TANK`. */
  activeSpecRole: string | null;
  gender: string | null;
  faction: string | null;
  /** The realm's display name ("Demon Soul"); the slug is the request's `realmSlug`. */
  realm: string;
  region: string;
  thumbnailUrl: string | null;
  achievementPoints: number | null;
  /** Raider.io's banner art for the profile, e.g. `classbanner_shaman1`. */
  profileBanner: string | null;
  profileUrl: string | null;
  /** When Raider.io last read the character from Blizzard. */
  lastCrawledAt: string | null;
}

/** One equipped item, with Raider.io's own field names. */
export interface PveGearItem {
  item_id: number;
  item_level: number;
  name: string;
  icon?: string;
  /** 0 poor … 4 epic, 5 legendary: the border colour. */
  item_quality?: number;
  /** The tier set the piece belongs to; absent on other items. */
  tier?: string;
  bonuses?: number[];
  enchants_detail?: unknown[];
  gems_detail?: unknown[];
}

export interface PveGear {
  itemLevelEquipped: number | null;
  /** Keyed by slot: `head`, `finger1`, `mainhand`, … */
  items: Record<string, PveGearItem>;
}

/**
 * A Mythic+ run as the page shows it, in every run list. Left out on purpose:
 * the run and dungeon ids, short name and expansion; an affix's name and
 * description, which Rankwarden's `mplus_affixes` holds; and the spec beyond
 * its id. `par_time_ms - clear_time_ms` is the time left on the key.
 */
export interface PveRun {
  dungeon: string;
  mythic_level: number;
  completed_at: string;
  clear_time_ms: number;
  par_time_ms: number | null;
  num_keystone_upgrades: number | null;
  score: number;
  icon_url: string | null;
  background_image_url: string | null;
  url: string | null;
  affixes: { id: number; icon_url: string | null; wowhead_url: string | null }[];
  spec: { id: number } | null;
  role: string | null;
}

/**
 * The character's place among the season's top players: within the top 0.1%
 * or 1% of its region, with the lowest score that still is.
 */
export interface TopPercent {
  percent: 0.1 | 1;
  minScore: number;
}

/** A season's scores: `{ season, scores: { all, dps, healer, tank, spec_0… } }`. */
export interface PveSeasonScores {
  season: string;
  scores: Record<string, unknown>;
  /** The colour Raider.io shows each of those scores in: `{ all: '#fe7e15', … }`. */
  colors: Record<string, string>;
  /**
   * Worked out on every answer from the season's cutoffs in Rankwarden, which
   * move through a live season. Null below the top 1% or without cutoffs.
   */
  topPercent: TopPercent | null;
}

/** An AOTC / Cutting Edge record: `{ raid, aotc?, cutting_edge? }`. */
export type RaidAchievementCurve = Record<string, unknown>;

/** The run lists of the whole page. */
export interface PveRunLists {
  /** The best run per dungeon this season. */
  mythicPlusBestRuns: PveRun[];
  /** The last 10 runs. */
  mythicPlusRecentRuns: PveRun[];
  /** The highest keys of the season. */
  mythicPlusHighestLevelRuns: PveRun[];
  /** The highest keys of this week: what the Great Vault rewards. */
  mythicPlusWeeklyHighestLevelRuns: PveRun[];
  mythicPlusPreviousWeeklyHighestLevelRuns: PveRun[];
}

/** The whole page, as one Raider.io request with every field returns it. */
export interface FullPart extends PveRunLists {
  fetchedAt: string;
  character: PveCharacterBase;
  guild: { name: string; realm: string | null } | null;
  gear: PveGear | null;
  talentLoadout: Record<string, unknown> | null;
  /** The current expansion's raids, keyed by raid slug. */
  raidProgression: Record<string, Record<string, unknown>>;
  /** AOTC and Cutting Edge for the current expansion's raids. */
  raidAchievementCurve: RaidAchievementCurve[];
  /** The current season, then the previous one. `topPercent` is filled per answer. */
  mythicPlusScores: Omit<PveSeasonScores, 'topPercent'>[];
  mythicPlusRanks: Record<string, unknown> | null;
}

/** One raid, for `raidProgression=<slug>`. */
export interface RaidPart {
  fetchedAt: string;
  character: PveCharacterBase;
  raidProgression: Record<string, Record<string, unknown>>;
  /** Empty when neither AOTC nor Cutting Edge was earned. */
  raidAchievementCurve: RaidAchievementCurve[];
}

/** One season, for `mplusSeasonScore=<slug>`. */
export interface SeasonPart {
  fetchedAt: string;
  character: PveCharacterBase;
  mythicPlusScores: Omit<PveSeasonScores, 'topPercent'>[];
}

export const RAID_DIFFICULTIES = ['lfr', 'normal', 'heroic', 'mythic'] as const;
export type RaidDifficulty = (typeof RAID_DIFFICULTIES)[number];

/** One raid boss and the character's kills of it, per difficulty killed on. */
export interface RaidBoss {
  slug: string;
  name: string;
  kills: Partial<Record<RaidDifficulty, { count: number; lastKillAt: string | null }>>;
}

/**
 * Per-boss kills from Blizzard, for every raid in the catalogue, keyed by raid
 * slug. Cached apart from the Raider.io parts: one Blizzard request serves the
 * whole page and every raid widget.
 */
export interface BossesPart {
  fetchedAt: string;
  raids: Record<string, RaidBoss[]>;
}

/**
 * `GET /pve/character`. Only the fields that were asked for are present: the
 * whole page without parameters; `raidProgression`, `raidAchievementCurve` and
 * `raidBosses` for a raid; `mythicPlusScores` for a season.
 */
export interface PveCharacterResponse extends Partial<PveRunLists> {
  region: RaiderIoRegion;
  realmSlug: string;
  character: PveCharacterBase;
  guild?: { name: string; realm: string | null } | null;
  gear?: PveGear | null;
  talentLoadout?: Record<string, unknown> | null;
  raidProgression?: Record<string, Record<string, unknown>>;
  raidAchievementCurve?: RaidAchievementCurve[];
  /**
   * Each boss of the raids shown, with kills per difficulty, from Blizzard.
   * Null where Blizzard cannot be asked: China, or a failure with nothing cached.
   */
  raidBosses?: Record<string, RaidBoss[]> | null;
  mythicPlusScores?: PveSeasonScores[];
  mythicPlusRanks?: Record<string, unknown> | null;
  /** When the oldest Raider.io part of the answer was fetched. */
  fetchedAt: string;
  /** Served past its freshness because Raider.io could not be asked. */
  stale: boolean;
}
