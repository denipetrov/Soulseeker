/**
 * The Rankwarden collections Soulseeker reads.
 *
 * The names are a contract with Rankwarden (`src/database/collections.ts`
 * there): renaming one is a migration on its side and a change here. Internal
 * and audit collections (`quota_windows`, `archive_brackets`,
 * `*_transitions`) are deliberately absent — a reader has no reason to use
 * them.
 */
export const Collections = {
  // PvP, live.
  Characters: 'characters',
  Ratings2v2: '2v2_ratings',
  Ratings3v3: '3v3_ratings',
  RatingsRbg: 'rbg_ratings',
  RatingsShuffle: 'shuffle_ratings',
  RatingsBlitz: 'blitz_ratings',
  SpecRepresentation: 'spec_representation',
  SeasonState: 'season_state',

  // PvP, archive.
  ArchiveEntries: 'archive_entries',
  ArchiveSeasons: 'archive_seasons',

  // Mythic+.
  MplusRuns: 'mplus_runs',
  MplusCharacters: 'mplus_characters',
  MplusAffixes: 'mplus_affixes',
  MplusDungeons: 'mplus_dungeons',
  MplusSeasons: 'mplus_seasons',
  MplusSeasonState: 'mplus_season_state',
  MplusSpecRepresentation: 'mplus_spec_representation',
  MplusArchiveRuns: 'mplus_archive_runs',
  MplusArchiveCharacters: 'mplus_archive_characters',

  // Raids.
  Raids: 'raids',
  Guilds: 'guilds',
} as const;

export type ReadCollection = (typeof Collections)[keyof typeof Collections];

/**
 * Rankwarden index names Soulseeker relies on by name, for `hint`. Part of the
 * same contract as the collection names: renaming one on Rankwarden's side
 * makes every hinted query here fail, loudly, rather than run without it.
 */
export const Indexes = {
  /** `{ searchName: 1 }` on `characters`. */
  CharacterSearch: 'character_search',
  /** `{ searchName: 1 }` on `mplus_characters`. */
  MplusCharacterSearch: 'mplus_character_search',
  /** `{ searchName: 1 }` on `guilds`. */
  GuildSearch: 'guild_search',
} as const;
