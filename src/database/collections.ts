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
  Bosses: 'bosses',
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

/** What a Mythic+ board index narrows by, besides season: nothing, or a profile field. */
export type MplusBoardKind = 'score' | 'class' | 'spec' | 'role';

/**
 * Rankwarden's Mythic+ board indexes, by collection, board kind, and whether
 * they serve one region or `world`. Every one is `season` (then `region`, for
 * one region), then the kind's field — none, `profile.classId`,
 * `profile.specId` or `profile.role` — then `mythicScore: -1`. Part of the
 * same contract as `Indexes`.
 *
 * The live collection has no score board without `region`: `world` uses
 * `mplus_score_board` with the region spelled out as `$in` every region.
 */
export const MplusBoardIndexes = {
  live: {
    score: { world: 'mplus_score_board', region: 'mplus_score_board' },
    class: { world: 'mplus_class_board', region: 'mplus_class_region_board' },
    spec: { world: 'mplus_spec_board', region: 'mplus_spec_region_board' },
    role: { world: 'mplus_role_board', region: 'mplus_role_region_board' },
  },
  archive: {
    score: { world: 'archive_score_board', region: 'archive_score_region_board' },
    class: { world: 'archive_class_board', region: 'archive_class_region_board' },
    spec: { world: 'archive_spec_board', region: 'archive_spec_region_board' },
    role: { world: 'archive_role_board', region: 'archive_role_region_board' },
  },
} as const satisfies Record<
  'live' | 'archive',
  Record<MplusBoardKind, { world: string; region: string }>
>;

/**
 * Rankwarden's Mythic+ run board indexes: `season`, then `region` (live, and
 * the archive's region board), then `dungeon.id` for a dungeon board, then
 * `score: -1`. The live collection has no index without `region`: `world`
 * spells the region out as `$in` every region. The archive has no region and
 * dungeon index together: that board walks the dungeon's and checks the region.
 * Part of the same contract as `Indexes`.
 */
export const MplusRunIndexes = {
  live: { board: 'run_board', dungeon: 'run_dungeon_board' },
  archive: {
    board: 'archive_run_board',
    region: 'archive_run_region_board',
    dungeon: 'archive_run_dungeon_board',
  },
} as const;
