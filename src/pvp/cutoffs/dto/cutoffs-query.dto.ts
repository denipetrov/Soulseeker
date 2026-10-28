import { z } from 'zod';

import { REGIONS } from '../../../blizzard/blizzard.constants.js';
import { CLASSES } from '../../leaderboard/dto/leaderboard-query.dto.js';

/**
 * The ladders that award a title. 2v2 awards none, so it has no cutoff to
 * count against and is not offered.
 */
export const CUTOFF_BRACKETS = ['3v3', 'rbg', 'shuffle', 'blitz'] as const;
export type CutoffBracket = (typeof CUTOFF_BRACKETS)[number];

/**
 * `GET /pvp/cutoffs?region=eu&bracket=shuffle[&class=mage&spec=fire]`
 *
 * Without `class` and `spec`: the cutoffs and a count per spec. With both: the
 * characters of that spec who reach the cutoff. They come as a pair, as on the
 * leaderboard: a spec name alone is ambiguous (`holy`, `frost`, `restoration`,
 * `protection` each belong to two classes).
 */
export const cutoffsQuerySchema = z
  .object({
    region: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(REGIONS))
      .meta({ description: 'Blizzard region.', enum: [...REGIONS], example: 'eu' }),
    bracket: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(CUTOFF_BRACKETS))
      .meta({
        description:
          'Ladder family. 3v3 and RBG have one cutoff; Shuffle and Blitz one per spec. ' +
          '2v2 awards no title.',
        enum: [...CUTOFF_BRACKETS],
        example: 'shuffle',
      }),
    class: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(CLASSES))
      .optional()
      .meta({
        description: 'With spec: list the characters of that spec who reach the cutoff.',
        enum: [...CLASSES],
      }),
    spec: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]+$/, 'must be a slug of letters, e.g. "beastmastery"')
      .optional()
      .meta({ description: 'Spec slug, e.g. `fire`. Needs class.' }),
  })
  .superRefine((query, ctx) => {
    if (Boolean(query.class) !== Boolean(query.spec)) {
      ctx.addIssue({
        code: 'custom',
        path: [query.class ? 'spec' : 'class'],
        message: 'class and spec go together',
      });
    }
  })
  .transform((query) => ({ ...query, class: query.class ?? null, spec: query.spec ?? null }));

export type CutoffsQuery = z.infer<typeof cutoffsQuerySchema>;
