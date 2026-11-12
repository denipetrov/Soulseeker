import { z } from 'zod';

import { slugSchema } from '../../bosses/dto/bosses-query.dto.js';

/**
 * `GET /pve/mplus-run?keystoneRunId=19324786[&season=season-mn-2]`
 *
 * `season` is optional: without it the run's season is found among the runs
 * Rankwarden stores, or taken to be the current one. With it, it must be the
 * run's own — Raider.io answers another season's run of the same id.
 */
export const mplusRunQuerySchema = z.object({
  keystoneRunId: z.coerce
    .number()
    .int()
    .positive()
    .meta({ description: 'The run, as `keystoneRunId` on `/pve/mplus-runs`.', example: 19324786 }),
  season: slugSchema.optional().meta({
    description:
      "The run's season slug. Optional: found from the stored runs, else the current season.",
    example: 'season-mn-2',
  }),
});

export type MplusRunQuery = z.infer<typeof mplusRunQuerySchema>;
