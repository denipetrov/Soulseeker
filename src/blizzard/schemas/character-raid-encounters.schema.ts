import { z } from 'zod';

const namedRef = z.object({ id: z.number().int(), name: z.string() });

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/encounters/raids
 *
 * Every raid boss the character has killed, by expansion, instance and
 * difficulty (~200 KB for an active player). Only kill counts and the last kill
 * per boss are kept. An instance or difficulty with no kill is absent.
 */
export const characterRaidEncountersSchema = z.object({
  expansions: z
    .array(
      z.object({
        expansion: namedRef,
        instances: z.array(
          z.object({
            instance: namedRef,
            modes: z.array(
              z.object({
                // `LFR`, `NORMAL`, `HEROIC`, `MYTHIC`; legacy raids add `LEGACY_10_MAN` and the like.
                difficulty: z.object({ type: z.string() }),
                progress: z.object({
                  encounters: z.array(
                    z.object({
                      encounter: namedRef,
                      completed_count: z.number().int(),
                      last_kill_timestamp: z.number().optional(),
                    }),
                  ),
                }),
              }),
            ),
          }),
        ),
      }),
    )
    .default([]),
});

export type CharacterRaidEncountersPayload = z.infer<typeof characterRaidEncountersSchema>;
