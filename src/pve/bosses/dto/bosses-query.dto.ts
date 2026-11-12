import { z } from 'zod';

import { REGIONS } from '../../../blizzard/blizzard.constants.js';
import { BOSS_DIFFICULTIES } from '../../../characters/entities/boss.entity.js';

/** The board across every region. */
export const WORLD = 'world';
/** `raidSlug=current`: the raid in progress (`PveCatalogue.currentRaid`). */
export const CURRENT_RAID = 'current';
/** Rankwarden keeps the first fifty guilds per board. */
export const MAX_TOP = 50;

export const BOSS_REGIONS = [WORLD, ...REGIONS] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug, e.g. "the-venomous-abyss"');

/**
 * `GET /pve/bosses?region=eu&raidSlug=the-venomous-abyss&bossSlug=sszorak&difficulty=mythic&top=10`
 *
 * Every parameter is optional: by default, every boss of the current raid on
 * the world board, each at the hardest difficulty that has guilds on it.
 */
export const bossesQuerySchema = z.object({
  region: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(BOSS_REGIONS))
    .default(WORLD)
    .meta({
      description: 'The board: `world`, or one region. Defaults to `world`.',
      enum: [...BOSS_REGIONS],
      example: 'eu',
    }),
  raidSlug: slugSchema.default(CURRENT_RAID).meta({
    description:
      'A raid slug, as `GET /pve/raids` lists them, or `current` (the default): the open raid ' +
      'of the newest expansion with the most bosses.',
    example: 'the-venomous-abyss',
  }),
  bossSlug: slugSchema
    .optional()
    .meta({ description: 'One boss of the raid, by slug: that boss only.', example: 'sszorak' }),
  difficulty: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(BOSS_DIFFICULTIES))
    .optional()
    .meta({
      description:
        'Without it, the hardest on which any of the bosses has guilds: mythic, then heroic, ' +
        'then normal. Every boss is answered at the same one.',
      enum: [...BOSS_DIFFICULTIES],
    }),
  top: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_TOP)
    .default(MAX_TOP)
    .meta({ description: `Guilds per boss, best first; 1–${MAX_TOP}, default ${MAX_TOP}.` }),
});

export type BossesQuery = z.infer<typeof bossesQuerySchema>;
