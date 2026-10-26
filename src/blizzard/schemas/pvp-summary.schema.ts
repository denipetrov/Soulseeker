import { z } from 'zod';

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/pvp-summary
 *
 * `brackets` links to every ladder the character has a rating on this season,
 * per-spec Shuffle and Blitz ladders included (`…/pvp-bracket/shuffle-paladin-holy`),
 * so it is the list of brackets to fetch: nothing is spent on ladders they
 * never played. Absent when they played none.
 */
export const pvpSummarySchema = z.object({
  brackets: z.array(z.object({ href: z.string() })).default([]),
  honor_level: z.number().int().optional(),
  honorable_kills: z.number().int().optional(),
});

export type PvpSummaryPayload = z.infer<typeof pvpSummarySchema>;

/**
 * The ladder name a bracket link points at: the last path segment, so
 * `…/pvp-bracket/shuffle-paladin-holy?namespace=profile-us` → `shuffle-paladin-holy`.
 * Null for a link of any other shape.
 */
export function bracketOfHref(href: string): string | null {
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return null;
  }

  const match = /\/pvp-bracket\/([a-z0-9-]+)\/?$/i.exec(path);

  return match ? match[1]!.toLowerCase() : null;
}
