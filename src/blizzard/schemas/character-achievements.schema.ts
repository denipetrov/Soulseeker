import { z } from 'zod';

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/achievements
 *
 * About 2 MB for an active player: every achievement of the account, with
 * criteria. Only what the PvP history reads is kept.
 *
 * Achievements are account-wide. `completed_timestamp` is when the account
 * first earned one; `criteria.is_completed` says whether this character
 * completed it themselves.
 */
export const characterAchievementsSchema = z.object({
  achievements: z
    .array(
      z.object({
        id: z.number().int(),
        achievement: z.object({ id: z.number().int(), name: z.string() }),
        criteria: z.object({ is_completed: z.boolean().optional() }).optional(),
        completed_timestamp: z.number().optional(),
      }),
    )
    .default([]),
});

export type CharacterAchievementsPayload = z.infer<typeof characterAchievementsSchema>;
