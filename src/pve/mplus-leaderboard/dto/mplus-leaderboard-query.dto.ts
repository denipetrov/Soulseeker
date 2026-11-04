import { z } from 'zod';

import { RAIDERIO_REGIONS } from '../../../raiderio/raiderio.constants.js';
import {
  CLASSES,
  DEFAULT_PAGE_SIZE,
  MAX_OFFSET,
  MAX_PAGE_SIZE,
} from '../../../pvp/leaderboard/dto/leaderboard-query.dto.js';
import { SPECS_BY_CLASS } from '../../../pvp/specs.js';
import { slugSchema, WORLD } from '../../bosses/dto/bosses-query.dto.js';

/** Every region together. */
export const MPLUS_BOARDS = [WORLD, ...RAIDERIO_REGIONS] as const;
/** `season=current`: the live season, from `mplus_season_state`. */
export const CURRENT_SEASON = 'current';
export const MPLUS_ROLES = ['tank', 'healer', 'dps'] as const;

const slugOf = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]+$/, 'must be a slug of letters, e.g. "beastmastery"');

/**
 * `GET /pve/mplus-leaderboard?region=eu&season=current&class=mage&spec=arcane&page=1&pageSize=50`
 *
 * Every parameter is optional. `spec` needs `class`; `role` takes `class` or
 * not, but never comes with `spec` — a spec has one role already.
 */
export const mplusLeaderboardQuerySchema = z
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
    class: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(CLASSES))
      .optional()
      .meta({ description: 'Class slug.', enum: [...CLASSES] }),
    spec: slugOf
      .optional()
      .meta({ description: 'Spec slug of `class`, e.g. `arcane`. Needs class; not with role.' }),
    role: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(MPLUS_ROLES))
      .optional()
      .meta({
        description: 'With or without class; not with spec.',
        enum: [...MPLUS_ROLES],
      }),
    page: z.coerce.number().int().positive().default(1).meta({ description: '1-based page.' }),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .meta({ description: `Characters per page, at most ${MAX_PAGE_SIZE}.` }),
  })
  .superRefine((query, ctx) => {
    if (query.spec && !query.class) {
      ctx.addIssue({ code: 'custom', path: ['spec'], message: 'needs class' });
    }
    if (query.spec && query.role) {
      ctx.addIssue({ code: 'custom', path: ['role'], message: 'cannot be combined with spec' });
    }
    if (query.spec && query.class && !SPECS_BY_CLASS[query.class].includes(query.spec)) {
      ctx.addIssue({ code: 'custom', path: ['spec'], message: `is not a ${query.class} spec` });
    }
    if ((query.page - 1) * query.pageSize > MAX_OFFSET) {
      ctx.addIssue({ code: 'custom', path: ['page'], message: `is past row ${MAX_OFFSET}` });
    }
  })
  .transform((query) => ({
    ...query,
    class: query.class ?? null,
    spec: query.spec ?? null,
    role: query.role ?? null,
  }));

export type MplusLeaderboardQuery = z.infer<typeof mplusLeaderboardQuerySchema>;
