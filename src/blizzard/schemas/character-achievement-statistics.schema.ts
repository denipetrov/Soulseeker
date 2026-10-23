import { z } from 'zod';

const statistic = z.object({
  id: z.number().int(),
  quantity: z.number().optional(),
});

interface StatisticCategory {
  statistics?: z.infer<typeof statistic>[];
  sub_categories?: StatisticCategory[];
}

const category: z.ZodType<StatisticCategory> = z.object({
  statistics: z.array(statistic).optional(),
  get sub_categories() {
    return z.array(category).optional();
  },
});

/**
 * GET /profile/wow/character/{realmSlug}/{characterName}/achievements/statistics
 *
 * Every statistic the account tracks, in nested categories (~100 KB). Only
 * ids and quantities are kept; statistics are matched by id, which does not
 * change with the language.
 */
export const characterAchievementStatisticsSchema = z.object({
  categories: z.array(category).default([]),
});

export type CharacterAchievementStatisticsPayload = z.infer<
  typeof characterAchievementStatisticsSchema
>;

/** Every statistic's quantity by id, from every category at any depth. */
export function statisticsById(
  payload: CharacterAchievementStatisticsPayload,
): Map<number, number> {
  const found = new Map<number, number>();

  const walk = (categories: readonly StatisticCategory[]) => {
    for (const { statistics, sub_categories } of categories) {
      for (const { id, quantity } of statistics ?? []) {
        if (quantity !== undefined) found.set(id, quantity);
      }
      walk(sub_categories ?? []);
    }
  };
  walk(payload.categories);

  return found;
}
