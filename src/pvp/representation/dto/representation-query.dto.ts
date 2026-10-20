import { REPRESENTATION_MIN_RATINGS } from '@denipetrov/spirit-link/constants';
import { z } from 'zod';

import { REGIONS } from '../../../blizzard/blizzard.constants.js';
import { CORE_BRACKETS, SPEC_FAMILIES } from '../../seasons/pvp-season.types.js';

const FAMILIES = [...CORE_BRACKETS, ...SPEC_FAMILIES] as const;

/** `date=latest`: the newest snapshot stored, whatever day it is. */
export const LATEST = 'latest';

/**
 * `GET /pvp/spec-representation?region=eu&bracket=3v3&rating=2100&date=2026-10-20&getEarliestDate=true`
 *
 * `rating` must be one of spirit-link's `REPRESENTATION_MIN_RATINGS`, the
 * cutoffs Rankwarden writes snapshots at and the front end offers: any other
 * value asks for a snapshot that was never written. `date` is a UTC calendar
 * day, or `latest`.
 */
export const representationQuerySchema = z.object({
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
    .pipe(z.enum(FAMILIES))
    .meta({ description: 'Ladder family.', enum: [...FAMILIES], example: '3v3' }),
  rating: z.coerce
    .number()
    .int()
    .refine((value) => (REPRESENTATION_MIN_RATINGS as readonly number[]).includes(value), {
      message: `must be one of ${REPRESENTATION_MIN_RATINGS.join(', ')}`,
    })
    .meta({
      description: 'Minimum rating: the snapshot counts players at or above it.',
      enum: [...REPRESENTATION_MIN_RATINGS],
      example: 2100,
    }),
  date: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value, ctx): Date | typeof LATEST => {
      if (value === LATEST) return LATEST;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        ctx.addIssue({ code: 'custom', message: `must be a date as YYYY-MM-DD, or "${LATEST}"` });
        return z.NEVER;
      }

      const day = new Date(`${value}T00:00:00.000Z`);

      // `2026-02-30` parses, as March 2nd; refuse it rather than answer for another day.
      if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
        ctx.addIssue({ code: 'custom', message: 'is not a calendar date' });
        return z.NEVER;
      }

      return day;
    })
    .meta({
      description:
        `The UTC day of the snapshot, as YYYY-MM-DD, or \`${LATEST}\` for the newest one ` +
        'stored — for when the day has turned but its snapshot is not computed yet. The ' +
        'response `date` says which day was answered.',
      example: LATEST,
    }),
  getEarliestDate: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .meta({
      description:
        'Also return `earliestDate`: the first day with classified specs for this region, ' +
        'bracket and rating. For the first load of the page.',
    }),
});

export type RepresentationQuery = z.infer<typeof representationQuerySchema>;
