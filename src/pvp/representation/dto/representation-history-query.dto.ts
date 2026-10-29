import type { z } from 'zod';

import { representationQuerySchema } from './representation-query.dto.js';

/** UTC days a history covers, today included. */
export const HISTORY_DAYS = 31;

/**
 * `GET /pvp/spec-representation/history?region=eu&bracket=shuffle&rating=2100`
 *
 * The daily endpoint's `region`, `bracket` and `rating`, exactly — picked from
 * its schema so the two cannot drift. No date: the window is always the last
 * `HISTORY_DAYS` UTC days.
 */
export const representationHistoryQuerySchema = representationQuerySchema.pick({
  region: true,
  bracket: true,
  rating: true,
});

export type RepresentationHistoryQuery = z.infer<typeof representationHistoryQuerySchema>;
