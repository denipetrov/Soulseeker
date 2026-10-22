import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';

/** Raider.io's base profile, sent with every answer whatever was asked. */
export interface PveCharacterBase {
  name: string;
  race: string;
  class: string;
  activeSpecName: string | null;
  gender: string | null;
  faction: string | null;
  /** The realm's display name ("Demon Soul"); the slug is the request's `realmSlug`. */
  realm: string;
  region: string;
  thumbnailUrl: string | null;
}

/** One equipped item, with Raider.io's own field names. */
export interface PveGearItem {
  item_id: number;
  item_level: number;
  name: string;
  icon?: string;
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
 * A best run as the page shows it. Left out on purpose: the run and dungeon
 * ids, par time, short name and expansion; an affix's name and description,
 * which Rankwarden's `mplus_affixes` holds; and the spec beyond its id.
 */
export interface PveBestRun {
  dungeon: string;
  mythic_level: number;
  completed_at: string;
  clear_time_ms: number;
  num_keystone_upgrades: number | null;
  score: number;
  icon_url: string | null;
  background_image_url: string | null;
  url: string | null;
  affixes: { id: number; icon_url: string | null; wowhead_url: string | null }[];
  spec: { id: number } | null;
  role: string | null;
}

/** A season's scores: `{ season, scores: { all, dps, healer, tank, spec_0… } }`. */
export interface PveSeasonScores {
  season: string;
  scores: Record<string, unknown>;
}

/** The whole page, as one Raider.io request with every field returns it. */
export interface FullPart {
  fetchedAt: string;
  character: PveCharacterBase;
  guild: { name: string } | null;
  gear: PveGear | null;
  talentLoadout: Record<string, unknown> | null;
  /** The current expansion's raids, keyed by raid slug. */
  raidProgression: Record<string, Record<string, unknown>>;
  /** The current season. */
  mythicPlusScores: PveSeasonScores[];
  mythicPlusRanks: Record<string, unknown> | null;
  mythicPlusBestRuns: PveBestRun[];
}

/** One raid, for `raidProgression=<slug>`. */
export interface RaidPart {
  fetchedAt: string;
  character: PveCharacterBase;
  raidProgression: Record<string, Record<string, unknown>>;
  /** `{ raid, aotc?, cutting_edge? }`; empty when neither was earned. */
  raidAchievementCurve: Record<string, unknown>[];
}

/** One season, for `mplusSeasonScore=<slug>`. */
export interface SeasonPart {
  fetchedAt: string;
  character: PveCharacterBase;
  mythicPlusScores: PveSeasonScores[];
}

/**
 * `GET /pve/character`. Only the fields that were asked for are present: the
 * whole page without parameters; `raidProgression` and `raidAchievementCurve`
 * for a raid; `mythicPlusScores` for a season.
 */
export interface PveCharacterResponse {
  region: RaiderIoRegion;
  realmSlug: string;
  character: PveCharacterBase;
  guild?: { name: string } | null;
  gear?: PveGear | null;
  talentLoadout?: Record<string, unknown> | null;
  raidProgression?: Record<string, Record<string, unknown>>;
  raidAchievementCurve?: Record<string, unknown>[];
  mythicPlusScores?: PveSeasonScores[];
  mythicPlusRanks?: Record<string, unknown> | null;
  mythicPlusBestRuns?: PveBestRun[];
  /** When the oldest part of the answer was fetched from Raider.io. */
  fetchedAt: string;
  /** Served past its freshness because Raider.io could not be asked. */
  stale: boolean;
}
