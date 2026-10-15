import type { Region } from '../../blizzard/blizzard.constants.js';

/**
 * A document in Rankwarden's `characters`: one PvP character per season and
 * region, with every ladder they appear on nested inside. Read-only here; the
 * shape is Rankwarden's (`src/leaderboard/entities/character.entity.ts`).
 *
 * Reader rules that bite (Rankwarden handbook, "Rules for readers"):
 * - always filter on `seasonId` and `region`;
 * - a query on `ratings.<bracket>` needs `{ $gt: 0 }`, or characters without
 *   that ladder sort first — prefer the flat `*_ratings` collections for boards;
 * - per-ladder hero talents come from `profile.talentLoadouts`, matched on the
 *   ladder's spec, never from `profile.heroTalentTree`.
 */
export interface NamedRef {
  id: number;
  name: string;
}

export interface BracketStanding {
  rank: number;
  rating: number;
  played: number;
  won: number;
  lost: number;
  fetchedAt: Date;
}

export interface CharacterProfile {
  race: NamedRef;
  class: NamedRef;
  spec: NamedRef | null;
  heroTalentTree: NamedRef | null;
  talentLoadouts: {
    spec: NamedRef;
    talentLoadoutCode: string | null;
    heroTalentTree: NamedRef | null;
  }[];
  level: number;
  gender: string | null;
  guild: NamedRef | null;
  realmName: string | null;
  title: string | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: Date | null;
}

export interface CharacterDocument {
  seasonId: number;
  region: Region;
  /** Blizzard's character id. Not Raider.io's. */
  characterId: number;
  characterType: 'PvP';
  characterName: string;
  realmId: number;
  realmSlug: string;
  faction: 'ALLIANCE' | 'HORDE' | null;
  /** Keyed by ladder name: `3v3`, `shuffle-mage-fire`, … */
  brackets: Record<string, BracketStanding>;
  /** Ladder name → rating; a mirror of `brackets` for one wildcard index. */
  ratings: Record<string, number>;
  updatedAt: Date;
  /** Absent until Rankwarden has enriched the character. */
  profile?: CharacterProfile;
  profileStatus?: 'ok' | 'missing' | 'unparseable';
  profileFetchedAt?: Date;
  specsFetchedAt?: Date;
}

/** A row in one of the flat `*_ratings` collections: one rating on one ladder. */
export interface RatingRow {
  seasonId: number;
  region: Region;
  bracket: string;
  characterId: number;
  rating: number;
  fetchedAt: Date;
}
