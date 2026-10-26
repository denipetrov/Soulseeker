import { z } from 'zod';
import { RaidDifficulty } from '@denipetrov/spirit-link/constants';

import { forceRefreshSchema, realmSlugSchema } from '../../../characters/dto/character-identity.js';
import { RAIDERIO_REGIONS } from '../../../raiderio/raiderio.constants.js';

/** Blizzard's limits on a guild name, in characters. */
const NAME_MIN = 2;
const NAME_MAX = 24;

const DIFFICULTIES = Object.values(RaidDifficulty);

/** A raid or boss slug: `tier-mn-1`, `midnight-falls`. Checked against the catalogue later. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug, e.g. "midnight-falls"')
  .max(80);

/**
 * `GET /pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo`
 *
 * One widget per call, so exactly one of:
 * - nothing else: the summary (progression, rankings, guild master and officers);
 * - `showFullRoster=true`: every member, never cached;
 * - `raidEncounters` + `difficulty`: one raid's bosses killed, with when;
 * - `raidEncounters` + `boss` + `difficulty`: the guild's kill of that boss.
 */
export const guildQuerySchema = z
  .object({
    region: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(RAIDERIO_REGIONS))
      .meta({ description: 'Region.', enum: [...RAIDERIO_REGIONS], example: 'eu' }),
    realmSlug: realmSlugSchema,
    guildName: z
      .string()
      .trim()
      .transform((name) => name.normalize('NFC').replace(/\s+/g, ' ').toLowerCase())
      .pipe(
        z
          .string()
          .regex(/^[\p{L} '-]+$/u, 'must be letters, spaces, apostrophes or hyphens')
          .refine(
            (name) => [...name].length >= NAME_MIN && [...name].length <= NAME_MAX,
            `must be ${NAME_MIN} to ${NAME_MAX} characters`,
          ),
      )
      .meta({ description: 'Guild name, any case.', example: 'Echo' }),
    showFullRoster: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true')
      .meta({
        description: 'Every member with their character, instead of the summary. Not cached.',
      }),
    raidEncounters: slug.optional().meta({
      description: 'A raid slug from the catalogue: the bosses the guild killed in it.',
      example: 'tier-mn-1',
    }),
    boss: slug.optional().meta({
      description:
        'A boss slug of `raidEncounters`: the guild’s kill of that boss, with its roster.',
      example: 'midnight-falls',
    }),
    difficulty: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(DIFFICULTIES))
      .optional()
      .meta({
        description: 'Required with `raidEncounters`.',
        enum: [...DIFFICULTIES],
        example: 'mythic',
      }),
    forceRefresh: forceRefreshSchema,
  })
  .superRefine((query, ctx) => {
    if (query.boss && !query.raidEncounters) {
      ctx.addIssue({ code: 'custom', path: ['boss'], message: 'needs raidEncounters' });
    }
    if ((query.raidEncounters || query.boss) && !query.difficulty) {
      ctx.addIssue({
        code: 'custom',
        path: ['difficulty'],
        message: 'is required with raidEncounters or boss',
      });
    }
    // With a boss, "boss needs raidEncounters" already says what is missing.
    if (query.difficulty && !query.raidEncounters && !query.boss) {
      ctx.addIssue({ code: 'custom', path: ['difficulty'], message: 'needs raidEncounters' });
    }
    if (query.showFullRoster && query.raidEncounters) {
      ctx.addIssue({
        code: 'custom',
        path: ['showFullRoster'],
        message: 'cannot be combined with raidEncounters: one widget per call',
      });
    }
  });

export type GuildQuery = z.infer<typeof guildQuerySchema>;
