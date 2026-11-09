import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_OFFSET,
  MAX_PAGE_SIZE,
} from '../../../pvp/leaderboard/dto/leaderboard-query.dto.js';
import { slugSchema, WORLD } from '../../bosses/dto/bosses-query.dto.js';
import { MPLUS_BOARDS } from '../../mplus-leaderboard/dto/mplus-leaderboard-query.dto.js';
import { CURRENT_SEASON } from '../../shared/mplus-season.resolver.js';

/**
 * `GET /pve/mplus-runs?region=eu&season=current&dungeon=murder-row&page=1&pageSize=50`
 *
 * Every parameter is optional.
 */
export const mplusRunsQuerySchema = z
  .object({
    region: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(MPLUS_BOARDS))
      .default(WORLD)
      .meta({
        description: '`world` (the default), or one region.',
        enum: [...MPLUS_BOARDS],
        example: 'eu',
      }),
    season: slugSchema.default(CURRENT_SEASON).meta({
      description:
        'A Mythic+ season slug, e.g. `season-mn-1`, or `current` (the default). A past ' +
        'season is read from the archive.',
      example: 'season-mn-2',
    }),
    dungeon: slugSchema.optional().meta({
      description:
        'A dungeon slug of the season, as `GET /pve/mplus-seasons` lists them: that ' +
        "dungeon's runs only.",
      example: 'murder-row',
    }),
    page: z.coerce.number().int().positive().default(1).meta({ description: '1-based page.' }),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .meta({ description: `Runs per page, at most ${MAX_PAGE_SIZE}.` }),
  })
  .superRefine((query, ctx) => {
    if ((query.page - 1) * query.pageSize > MAX_OFFSET) {
      ctx.addIssue({ code: 'custom', path: ['page'], message: `is past row ${MAX_OFFSET}` });
    }
  })
  .transform((query) => ({ ...query, dungeon: query.dungeon ?? null }));

export type MplusRunsQuery = z.infer<typeof mplusRunsQuerySchema>;
