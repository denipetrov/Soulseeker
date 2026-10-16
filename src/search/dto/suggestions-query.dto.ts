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

/** Longest raw query accepted: a guild name is at most 24 characters. */
export const MAX_QUERY_LENGTH = 32;

/**
 * `GET /search/suggestions?type=pvp&q=biba`
 *
 * `type` is case-insensitive (`PvP`, `pvp`). `q` is folded with spirit-link's
 * `searchNameOf` — the same function Rankwarden stores `searchName` with — so
 * `Bìbà`, `BIBA` and `biba` are the same search. The folded form is what is
 * checked for length, since that is what is searched.
 */
export const suggestionsQuerySchema = z.object({
  type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum([SearchType.PvP, SearchType.PvE])),
  q: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .transform((value) => searchNameOf(value))
    .pipe(z.string().min(MIN_QUERY_LENGTH)),
});

export type SuggestionsQuery = z.infer<typeof suggestionsQuerySchema>;
