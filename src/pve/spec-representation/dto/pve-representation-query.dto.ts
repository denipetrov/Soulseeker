import { z } from 'zod';

import { slugSchema } from '../../bosses/dto/bosses-query.dto.js';
import { mplusRunBoardSchema } from '../../mplus-runs/dto/mplus-runs-query.dto.js';

/** `dungeonSlug=all`: every dungeon of the season together. */
export const ALL_DUNGEONS = 'all';

/**
 * `GET /pve/spec-representation?region=eu&dungeonSlug=murder-row&season=current&getSeasons=true`
 *
 * Every parameter is optional. Rankwarden keeps one snapshot per season, not
 * per day, so the season is what is picked — where the PvP endpoint picks a
 * date — and `getSeasons` lists the seasons with a snapshot, where the PvP one
 * gives the earliest date.
 */
export const pveRepresentationQuerySchema = mplusRunBoardSchema
  .pick({ region: true, season: true })
  .extend({
    dungeonSlug: slugSchema.default(ALL_DUNGEONS).meta({
      description:
        'A dungeon slug of the season, as `GET /pve/mplus-seasons` lists them, or `all` ' +
        '(the default): every dungeon together.',
      example: 'murder-row',
    }),
    getSeasons: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false)
      .meta({
        description:
          'Also list the seasons that have a snapshot for this region and dungeon, newest ' +
          'first: for a season picker.',
      }),
  });

export type PveRepresentationQuery = z.infer<typeof pveRepresentationQuerySchema>;
