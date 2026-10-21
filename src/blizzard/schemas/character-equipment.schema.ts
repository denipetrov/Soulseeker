import { z } from 'zod';

/** A part of an item kept as Blizzard shapes it, in the requested language. */
const asIs = z.unknown();

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/equipment
 *
 * Each item keeps only what the PvP page renders: identity, slot, bonus ids,
 * enchantments, sockets, set and transmog. Stats, armor, durability, prices
 * and requirements are dropped here, as they would be most of what is cached.
 * The kept parts are passed through as they come.
 */
export const characterEquipmentSchema = z.object({
  equipped_items: z
    .array(
      z.object({
        item: z.object({ id: z.number().int() }),
        slot: z.object({ type: z.string(), name: z.string() }),
        name: z.string().optional(),
        media: z.object({ id: z.number().int() }).optional(),
        bonus_list: z.array(z.number().int()).optional(),
        enchantments: z.array(asIs).optional(),
        sockets: z.array(asIs).optional(),
        set: asIs.optional(),
        transmog: asIs.optional(),
      }),
    )
    .default([]),
  equipped_item_sets: z
    .array(z.looseObject({ item_set: z.object({ id: z.number().int(), name: z.string() }) }))
    .default([]),
});

export type CharacterEquipmentPayload = z.infer<typeof characterEquipmentSchema>;
