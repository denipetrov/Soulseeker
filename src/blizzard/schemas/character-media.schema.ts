import { z } from 'zod';

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/character-media
 *
 * Render URLs by key: `avatar` (a small portrait), `main-raw` (the full
 * character on a transparent background), and on some characters `inset` and
 * `main`.
 */
export const characterMediaSchema = z.object({
  assets: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
});

export type CharacterMediaPayload = z.infer<typeof characterMediaSchema>;
