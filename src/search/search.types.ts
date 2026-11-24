import type { SearchType } from './dto/suggestions-query.dto.js';

/**
 * One character suggestion, PvP or Mythic+.
 *
 * Fields a character has not got yet are null rather than absent: a PvP
 * character Rankwarden has not enriched has no class or spec, and Mythic+
 * characters carry no hero talents at all.
 */
export interface CharacterSuggestion {
  characterName: string;
  region: string;
  realmSlug: string;
  realmName: string | null;
  className: string | null;
  /** Blizzard's class id. */
  classId: number | null;
  specName: string | null;
  /** Blizzard's spec id. */
  specId: number | null;
  /** The active spec's hero talent tree. Always null for Mythic+ characters. */
  heroTalents: string | null;
  /** Blizzard's id for that tree. Always null for Mythic+ characters. */
  heroTalentId: number | null;
  raceName: string | null;
  /** Blizzard's race id. */
  raceId: number | null;
  /** Lowercase: `alliance` or `horde`. */
  faction: string | null;
}

export interface GuildSuggestion {
  name: string;
  region: string;
  realmSlug: string;
  realmName: string;
  /** Raider.io's logo image URL, as Rankwarden stores it; null when the guild has none. */
  logo: string | null;
}

export interface SuggestionsResponse {
  type: SearchType;
  /** The folded prefix that was searched. */
  query: string;
  characters: CharacterSuggestion[];
  /** Always empty for a PvP search. */
  guilds: GuildSuggestion[];
}
