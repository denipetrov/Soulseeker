import { z } from 'zod';

import { mplusRunBoardSchema } from '../../mplus-runs/dto/mplus-runs-query.dto.js';

export const DEFAULT_TOP_RUNS = 1_000;
/** The most runs read for one answer: a page of index walk, not a scan of the board. */
export const MAX_TOP_RUNS = 10_000;

/**
 * `GET /pve/mplus-compositions?region=eu&season=current&dungeon=murder-row&top=1000`
 *
 * The board of `GET /pve/mplus-runs`, read to its `top` best runs instead of a page.
 */
export const mplusCompositionsQuerySchema = mplusRunBoardSchema
  .extend({
    top: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_TOP_RUNS)
      .default(DEFAULT_TOP_RUNS)
      .meta({
        description:
          `How many of the board's best runs to count, 1–${MAX_TOP_RUNS}; ` +
          `default ${DEFAULT_TOP_RUNS}.`,
      }),
  })
  .transform((query) => ({ ...query, dungeon: query.dungeon ?? null }));

export type MplusCompositionsQuery = z.infer<typeof mplusCompositionsQuerySchema>;
