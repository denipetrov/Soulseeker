import type { z } from 'zod';

import { representationQuerySchema } from '../../representation/dto/representation-query.dto.js';

/** `GET /pvp/tier-list?region=eu&bracket=shuffle`: the current season's ladder. */
export const tierListQuerySchema = representationQuerySchema.pick({ region: true, bracket: true });

export type TierListQuery = z.infer<typeof tierListQuerySchema>;
