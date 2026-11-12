import type { z } from 'zod';

import { mplusRunBoardSchema } from '../../mplus-runs/dto/mplus-runs-query.dto.js';

/** `GET /pve/tier-list?region=eu`: the current Mythic+ season. */
export const pveTierListQuerySchema = mplusRunBoardSchema.pick({ region: true });

export type PveTierListQuery = z.infer<typeof pveTierListQuerySchema>;
