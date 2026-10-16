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
  specName: string | null;
  /** The active spec's hero talent tree. Always null for Mythic+ characters. */
  heroTalents: string | null;
  raceName: string | null;
  /** Lowercase: `alliance` or `horde`. */
  faction: string | null;
}

export interface GuildSuggestion {
  name: string;
  region: string;
  realmSlug: string;
  realmName: string;
}

export interface SuggestionsResponse {
  type: SearchType;
  /** The folded prefix that was searched. */
  query: string;
  characters: CharacterSuggestion[];
  /** Always empty for a PvP search. */
  guilds: GuildSuggestion[];
}
