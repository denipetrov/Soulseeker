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
  versatilityDamageDoneBonus: number | null;
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
  equipment: PvpCharacterEquipment | null;
  pvpHistory: PvpHistoryEntry[];
  /** When the older of the two cached parts was fetched from Blizzard. */
  fetchedAt: string;
  /** Served past its freshness because Blizzard could not be asked (budget spent). */
  stale: boolean;
}
