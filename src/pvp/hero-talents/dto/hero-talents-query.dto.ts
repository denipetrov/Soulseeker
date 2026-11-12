import { z } from 'zod';

import { representationQuerySchema } from '../../representation/dto/representation-query.dto.js';

export const DEFAULT_TOP = 50;
/** The most characters read per spec: 40 specs of it make the answer's whole read. */
export const MAX_TOP = 500;

/**
 * `GET /pvp/hero-talents?region=eu&bracket=3v3&top=50`: the current season's
 * ladder, each spec's top `top` characters.
 */
export const heroTalentsQuerySchema = representationQuerySchema
  .pick({ region: true, bracket: true })
  .extend({
    top: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_TOP)
      .default(DEFAULT_TOP)
      .meta({
        description: `Characters per spec, the best of its ladder: 1–${MAX_TOP}, default ${DEFAULT_TOP}.`,
      }),
  });

export type HeroTalentsQuery = z.infer<typeof heroTalentsQuerySchema>;
