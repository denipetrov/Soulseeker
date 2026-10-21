import { z } from 'zod';

const matchStatistics = z.object({
  played: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
});

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/pvp-bracket/{bracket}
 *
 * One character's standing on one ladder this season. Kept to what a
 * `POST /characters/sync` to Rankwarden needs: rating and the season record.
 * The rank is not here — only the leaderboard carries it.
 */
export const pvpBracketSchema = z.object({
  bracket: z.object({ id: z.number().int(), type: z.string() }),
  rating: z.number().int(),
  season: z.object({ id: z.number().int() }).optional(),
  season_match_statistics: matchStatistics.optional(),
  weekly_match_statistics: matchStatistics.optional(),
  // Solo Shuffle and Blitz only: the spec the ladder is for.
  specialization: z.object({ id: z.number().int(), name: z.string() }).optional(),
});

export type PvpBracketPayload = z.infer<typeof pvpBracketSchema>;
