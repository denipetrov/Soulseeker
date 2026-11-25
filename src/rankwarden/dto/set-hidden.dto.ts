import { z } from 'zod';

import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';

/**
 * Mirror of Rankwarden's `POST /hidden` body (`src/hidden/dto/set-hidden.dto.ts`
 * there). Keep in step with it: a 400 from Rankwarden means the two drifted.
 *
 * A player is named by region, realm and name and is hidden in PvP and Mythic+,
 * every season. A guild is named by its Raider.io id.
 */
export const setHiddenSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character'),
    region: z.enum(RAIDERIO_REGIONS),
    realmSlug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    hidden: z.boolean(),
  }),
  z.object({
    kind: z.literal('guild'),
    guildId: z.number().int().positive(),
    hidden: z.boolean(),
  }),
]);

export type SetHiddenInput = z.infer<typeof setHiddenSchema>;
