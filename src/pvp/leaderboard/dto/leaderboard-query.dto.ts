import { z } from 'zod';

import { REGIONS } from '../../../blizzard/blizzard.constants.js';
import { CORE_BRACKETS, SPEC_FAMILIES } from '../../seasons/pvp-season.types.js';

/** Class slugs as Rankwarden stores them on the ratings rows and in ladder names. */
export const CLASSES = [
  'deathknight',
  'demonhunter',
  'druid',
  'evoker',
  'hunter',
  'mage',
  'monk',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
] as const;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Deepest row a page may start at. The largest board (Solo Shuffle, all specs,
 * one region) is about 120,000 rows; a skip that deep reads index keys only
 * and takes ~40 ms, so this bounds the cost without hiding any real board.
 */
export const MAX_OFFSET = 200_000;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]+$/, 'must be a slug of letters, e.g. "beastmastery"');

/**
 * `GET /pvp/leaderboard?region=eu&seasonId=42&bracket=shuffle&class=mage&spec=fire&page=1`
 *
 * `bracket` is a ladder family — `2v2`, `3v3`, `rbg`, `shuffle`, `blitz` — or
 * one spec ladder by its full name, `shuffle-mage-fire`, which is the same as
 * `bracket=shuffle&class=mage&spec=fire`. `spec` needs `class`.
 */
export const leaderboardQuerySchema = z
  .object({
    region: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(REGIONS))
      .meta({ description: 'Blizzard region.', enum: [...REGIONS], example: 'eu' }),
    seasonId: z.coerce.number().int().positive().meta({
      description: 'Blizzard PvP season id. The live one reads current ratings.',
      example: 42,
    }),
    bracket: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .meta({
        description:
          'Ladder family, or one spec ladder by name: `shuffle-mage-fire` is the same as ' +
          '`bracket=shuffle&class=mage&spec=fire`. Archived Shuffle and Blitz need class and spec.',
        enum: [...CORE_BRACKETS, ...SPEC_FAMILIES],
        example: '3v3',
      }),
    class: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(CLASSES))
      .optional()
      .meta({
        description: 'Class slug. Current season only, except to name an archived spec ladder.',
        enum: [...CLASSES],
      }),
    spec: slug
      .optional()
      .meta({ description: 'Spec slug, e.g. `fire`, `beastmastery`. Needs class.' }),
    page: z.coerce.number().int().positive().default(1).meta({ description: '1-based page.' }),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .meta({ description: 'Rows per page.' }),
  })
  .transform((query, ctx) => {
    let { bracket, class: cls, spec } = query;

    // A full spec ladder name, split into the family and the two filters.
    const family = SPEC_FAMILIES.find((name) => bracket.startsWith(`${name}-`));
    if (family) {
      const [ladderClass, ...rest] = bracket.slice(family.length + 1).split('-');
      const ladderSpec = rest.join('');

      if (!(CLASSES as readonly string[]).includes(ladderClass ?? '') || !ladderSpec) {
        ctx.addIssue({ code: 'custom', path: ['bracket'], message: `unknown ladder "${bracket}"` });
        return z.NEVER;
      }
      if ((cls && cls !== ladderClass) || (spec && spec !== ladderSpec)) {
        ctx.addIssue({
          code: 'custom',
          path: ['bracket'],
          message: 'names a different class or spec than the class and spec given',
        });
        return z.NEVER;
      }

      bracket = family;
      cls = ladderClass as (typeof CLASSES)[number];
      spec = ladderSpec;
    }

    const families: readonly string[] = [...CORE_BRACKETS, ...SPEC_FAMILIES];
    if (!families.includes(bracket)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bracket'],
        message: `must be one of ${families.join(', ')}, or a spec ladder like shuffle-mage-fire`,
      });
      return z.NEVER;
    }

    if (spec && !cls) {
      ctx.addIssue({ code: 'custom', path: ['spec'], message: 'needs class' });
      return z.NEVER;
    }

    if ((query.page - 1) * query.pageSize > MAX_OFFSET) {
      ctx.addIssue({ code: 'custom', path: ['page'], message: `is past row ${MAX_OFFSET}` });
      return z.NEVER;
    }

    return {
      region: query.region,
      seasonId: query.seasonId,
      bracket: bracket as LeaderboardBracket,
      class: cls ?? null,
      spec: spec ?? null,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

export type LeaderboardBracket = (typeof CORE_BRACKETS)[number] | (typeof SPEC_FAMILIES)[number];
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
