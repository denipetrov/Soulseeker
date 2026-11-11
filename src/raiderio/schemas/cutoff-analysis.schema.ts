import { z } from 'zod';

/**
 * GET /mythic-plus/cutoff-analysis/summary?season=&region=&format=json
 *
 * How a season's top-percentile cutoffs stand in a region (or `world`): the
 * current snapshot per population — overall, Horde, Alliance — with the title
 * cutoff and the 0.1 / 1 / 5 / 10 / 25 / 40 % scores, and `history`, one entry
 * per day since the season started. ~25–42 KB. Kept whole: the endpoint is a
 * proxy. Raider.io answers 404 for a season or region it has no analysis for
 * (none before The War Within's later seasons).
 */
export const raiderIoCutoffAnalysisSchema = z.looseObject({
  season: z.string(),
  region: z.string(),
  snapshotDate: z.string().optional(),
  updatedAt: z.string().optional(),
  populations: z.array(z.unknown()).optional(),
  history: z
    .array(
      z.looseObject({
        date: z.string(),
        population: z.number().nullable().optional(),
        cutoffs: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});

export type RaiderIoCutoffAnalysisPayload = z.infer<typeof raiderIoCutoffAnalysisSchema>;
