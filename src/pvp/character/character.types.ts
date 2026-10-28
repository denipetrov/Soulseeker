import type { Locale, Region } from '../../blizzard/blizzard.constants.js';
import type { NamedRef } from '../../characters/entities/character.entity.js';
import type { Faction } from '../seasons/pvp-season.types.js';
import type { PvpHistoryEntry } from './pvp-history.js';

/** A stat as the character sheet shows it: `value` is the percentage, `rating` the rating behind it. */
export interface RatedStat {
  value: number | null;
  rating: number | null;
}

export interface PvpCharacterStatistics {
  avoidance: RatedStat | null;
  lifesteal: RatedStat | null;
  speed: RatedStat | null;
  mastery: RatedStat | null;
  meleeCrit: RatedStat | null;
  meleeHaste: RatedStat | null;
  /** The versatility rating, whose damage-done effect is `versatilityDamageDoneBonus`. */
  versatility: number | null;
  versatilityDamageDoneBonus: number | null;
}

export interface MatchRecord {
  played: number;
  won: number;
  lost: number;
}

/** The character's standing on one ladder this season. */
export interface PvpCharacterBracket {
  /** As Blizzard names the ladder: `3v3`, `shuffle-paladin-holy`. */
  bracket: string;
  rating: number;
  played: number;
  won: number;
  lost: number;
  /** Shuffle and Blitz: the spec the ladder is for. */
  specialization: NamedRef | null;
  /** Solo Shuffle: the rounds behind the match record. Null on every other ladder. */
  rounds: MatchRecord | null;
  /**
   * The rank on the ladder, as Rankwarden's last sweep recorded it. Read on every
   * answer, not cached; null when Rankwarden does not track the character or ladder.
   */
  rank: number | null;
  /**
   * The rating on this ladder before Rankwarden's latest write, read from
   * `characters` like `rank` — and, when this answer fetched fresh ratings,
   * read after this answer's own sync, so it is the rating before that.
   * Equal to `rating` when nothing moved; null when Rankwarden does not track
   * the character or ladder, or it is new on it.
   */
  previousRating: number | null;
}

/**
 * The highest personal rating the character ever reached, from Blizzard's
 * achievement statistics. Blizzard tracks no such statistic for RBG, Solo
 * Shuffle or Blitz. Null when never played.
 */
export interface HighestRatings {
  '2v2': number | null;
  '3v3': number | null;
  /** Legacy: 5v5 arenas ended in Mists of Pandaria. */
  '5v5': number | null;
}

/** A selected talent with its tooltip, as Blizzard shapes it. */
export type Talent = Record<string, unknown> & { id: number; rank: number };

export interface PvpTalentSlot {
  slotNumber: number;
  /** Talent and spell tooltip, as Blizzard shapes them; null for an empty slot. */
  selected: Record<string, unknown> | null;
}

/** The active loadout of one specialisation. */
export interface ActiveLoadout {
  talentLoadoutCode: string | null;
  heroTalentTree: NamedRef | null;
  classTalents: Talent[];
  specTalents: Talent[];
  heroTalents: Talent[];
}

export interface PvpCharacterSpecializations {
  activeSpecialization: NamedRef | null;
  activeHeroTalentTree: NamedRef | null;
  specializations: {
    specialization: NamedRef;
    pvpTalentSlots: PvpTalentSlot[];
    /** Null when the spec has no active loadout. */
    loadout: ActiveLoadout | null;
  }[];
}

export interface PvpCharacterProfile {
  id: number;
  name: string;
  realm: { id: number; slug: string; name: string };
  faction: Faction | null;
  level: number;
  /** `type` is `male` / `female`; `name` is in the requested language. */
  gender: { type: string; name: string } | null;
  race: NamedRef;
  class: NamedRef;
  activeSpec: NamedRef | null;
  /** `displayString` holds `{name}` where the character's name goes. */
  activeTitle: { id: number; name: string; displayString: string } | null;
  guild: NamedRef | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: string | null;
}

export interface PvpCharacterEquipment {
  /** Every equipped item, as Blizzard shapes it, without its API links. */
  items: Record<string, unknown>[];
  sets: Record<string, unknown>[];
}

/**
 * What one lookup caches for every language: ratings, stats, render URLs and
 * achievements carry no translated names (achievements are always read in
 * English, which the history parses).
 */
export interface CorePart {
  fetchedAt: string;
  /** The season the ladders are from; null when the character has no rating. */
  seasonId: number | null;
  media: { avatar: string | null; mainRaw: string | null } | null;
  brackets: PvpCharacterBracket[];
  honor: { level: number | null; honorableKills: number | null } | null;
  statistics: PvpCharacterStatistics | null;
  highestRatings: HighestRatings | null;
  pvpHistory: PvpHistoryEntry[];
}

/** What one lookup caches per language. */
export interface LocalizedPart {
  fetchedAt: string;
  locale: Locale;
  profile: PvpCharacterProfile;
  specializations: PvpCharacterSpecializations | null;
  equipment: PvpCharacterEquipment | null;
}

/** `GET /pvp/character` */
export interface PvpCharacterResponse {
  region: Region;
  locale: Locale;
  seasonId: number | null;
  character: PvpCharacterProfile;
  media: CorePart['media'];
  brackets: PvpCharacterBracket[];
  honor: CorePart['honor'];
  specializations: PvpCharacterSpecializations | null;
  statistics: PvpCharacterStatistics | null;
  highestRatings: HighestRatings | null;
  equipment: PvpCharacterEquipment | null;
  pvpHistory: PvpHistoryEntry[];
  /** When the older of the two cached parts was fetched from Blizzard. */
  fetchedAt: string;
  /** Served past its freshness because Blizzard could not be asked (budget spent). */
  stale: boolean;
}
