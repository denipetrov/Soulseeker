import { z } from 'zod';

import { BOSS_DIFFICULTIES } from '../../../characters/entities/boss.entity.js';
import { bossesQuerySchema, slugSchema } from '../../bosses/dto/bosses-query.dto.js';

/**
 * `GET /pve/raid?raidSlug=the-venomous-abyss&region=eu&difficulty=heroic`
 *
 * `raidSlug` is required; it also takes `current`, as `GET /pve/bosses` does.
 */
export const raidQuerySchema = bossesQuerySchema.pick({ region: true }).extend({
  raidSlug: slugSchema.meta({
    description:
      'A raid slug, as `GET /pve/raids` lists them, or `current`: the open raid of the newest ' +
      'expansion with the most bosses.',
    example: 'the-venomous-abyss',
  }),
  difficulty: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(BOSS_DIFFICULTIES))
    .default('mythic')
    .meta({ description: 'Defaults to `mythic`.', enum: [...BOSS_DIFFICULTIES] }),
});

export type RaidQuery = z.infer<typeof raidQuerySchema>;
