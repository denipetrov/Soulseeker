import { z } from 'zod';

import { CLASSES } from '../../leaderboard/dto/leaderboard-query.dto.js';
import { checkRoleFilters, roleSchema, subRoleSchema } from '../../roles.js';
import { pvpBoardSchema } from '../../world.js';

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
 *
 * `role` and `subRole` narrow the counts to the specs of that role (and of
 * `class`, when given with them); never with `spec`.
 */
export const cutoffsQuerySchema = z
  .object({
    region: pvpBoardSchema,
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
    role: roleSchema,
    subRole: subRoleSchema,
  })
  .superRefine((query, ctx) => {
    // A class alone narrows nothing, unless a role picks some of its specs.
    const roleFiltered = Boolean(query.role || query.subRole);
    if (query.spec ? !query.class : query.class && !roleFiltered) {
      ctx.addIssue({
        code: 'custom',
        path: [query.class ? 'spec' : 'class'],
        message: 'class and spec go together',
      });
      return;
    }
    checkRoleFilters(query, ctx);
  })
  .transform((query) => ({
    ...query,
    class: query.class ?? null,
    spec: query.spec ?? null,
    role: query.role ?? null,
    subRole: query.subRole ?? null,
  }));

export type CutoffsQuery = z.infer<typeof cutoffsQuerySchema>;
