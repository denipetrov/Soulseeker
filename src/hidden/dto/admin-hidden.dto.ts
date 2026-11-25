import { z } from 'zod';

import { RAIDERIO_REGIONS } from '../../raiderio/raiderio.constants.js';

const region = z.string().trim().toLowerCase().pipe(z.enum(RAIDERIO_REGIONS));
const realmSlug = z.string().trim().toLowerCase().min(1).max(64);
const name = z.string().trim().min(1).max(64);

/**
 * `POST /admin/hidden`: hide or show a player or a guild.
 *
 * - A player by `region`, `realmSlug` and `name`: hidden in PvP and Mythic+,
 *   every season, whatever the name's case.
 * - A guild by `guildId` (Raider.io's), or by `region`, `realmSlug` and `name`,
 *   which must then be stored in Rankwarden for its id to be found.
 */
export const adminHiddenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), region, realmSlug, name, hidden: z.boolean() }),
  z
    .object({
      kind: z.literal('guild'),
      guildId: z.number().int().positive().optional(),
      region: region.optional(),
      realmSlug: realmSlug.optional(),
      name: name.optional(),
      hidden: z.boolean(),
    })
    .refine(
      (guild) => guild.guildId !== undefined || (guild.region && guild.realmSlug && guild.name),
      {
        message: 'give guildId, or region, realmSlug and name',
        path: ['guildId'],
      },
    ),
]);

export type AdminHiddenInput = z.infer<typeof adminHiddenSchema>;
