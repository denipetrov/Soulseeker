import { searchNameOf } from '@denipetrov/spirit-link/search';
import { z } from 'zod';

export const SearchType = {
  PvP: 'pvp',
  PvE: 'pve',
} as const;
export type SearchType = (typeof SearchType)[keyof typeof SearchType];

/**
 * Shortest folded prefix searched. One letter matches a large share of every
 * collection and suggests nothing useful.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * Longest query accepted, before folding and after: the longest stored name is
 * 24 characters (a guild). Checked on both sides because folding can grow a
 * string — one ligature such as U+FDFA folds to eighteen characters.
 */
export const MAX_QUERY_LENGTH = 32;

/**
 * What a folded name can contain, and so all a search may: letters of any
 * script, digits, spaces, and the `-`, `!` and `*` that real names use
 * (`Telegon-306757597`, `Repugnant!`, the guild `***`).
 *
 * An allowlist, not a blocklist. It is what keeps out everything that is not a
 * name: a NUL byte, which MongoDB refuses inside a regex (a 500 before this),
 * control and invisible formatting characters (zero-width, right-to-left
 * override), broken UTF-16, and markup or operators (`<`, `$`, `{`). Regex
 * syntax is escaped before the query anyway; this keeps such text out of the
 * echoed `query` and the cache keys too. Widen it only for a character a stored
 * name has been seen to use.
 */
export const NAME_CHARACTERS = /^[\p{L}\p{N} !*-]+$/u;

/**
 * `GET /search/suggestions?type=pvp&q=biba`
 *
 * `type` is case-insensitive (`PvP`, `pvp`). `q` is folded with spirit-link's
 * `searchNameOf` — the same function Rankwarden stores `searchName` with — so
 * `Bìbà`, `BIBA` and `biba` are the same search. The folded form is what is
 * checked for length and characters, since that is what is searched.
 *
 * Error messages never repeat the input.
 */
export const suggestionsQuerySchema = z.object({
  type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum([SearchType.PvP, SearchType.PvE]))
    .meta({
      description: 'PvP: current PvP characters. PvE: Mythic+ characters and guilds. Any case.',
      enum: [SearchType.PvP, SearchType.PvE],
      example: SearchType.PvP,
    }),
  q: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .transform((value) => searchNameOf(value))
    .pipe(
      z
        .string()
        .min(MIN_QUERY_LENGTH)
        .max(MAX_QUERY_LENGTH)
        .regex(NAME_CHARACTERS, 'may only contain letters, digits, spaces and - ! *'),
    )
    .meta({
      description:
        `Start of a name; case and accents are ignored ("biba" finds "Bìbà"). ` +
        `${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters: letters, digits, spaces ` +
        'and - ! *.',
      example: 'biba',
    }),
});

export type SuggestionsQuery = z.infer<typeof suggestionsQuerySchema>;
