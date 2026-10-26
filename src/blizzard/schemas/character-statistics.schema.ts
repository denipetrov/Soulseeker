import { z } from 'zod';

/**
 * A secondary or tertiary stat. `value` is the percentage the character has
 * in total; `rating_bonus` the part their rating gives. Avoidance and speed
 * carry no `value`: for them the rating is the whole bonus.
 */
const ratedStat = z.object({
  value: z.number().optional(),
  rating_bonus: z.number().optional(),
  rating_normalized: z.number().optional(),
});

/** GET /profile/wow/character/{realmSlug}/{characterName}/statistics — the stats shown on a PvP page. */
export const characterStatisticsSchema = z.object({
  avoidance: ratedStat.optional(),
  lifesteal: ratedStat.optional(),
  speed: ratedStat.optional(),
  mastery: ratedStat.optional(),
  melee_crit: ratedStat.optional(),
  melee_haste: ratedStat.optional(),
  /** The versatility rating; its effects are the three `versatility_*_bonus` percentages. */
  versatility: z.number().optional(),
  versatility_damage_done_bonus: z.number().optional(),
});

export type CharacterStatisticsPayload = z.infer<typeof characterStatisticsSchema>;
