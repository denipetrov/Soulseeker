import type { z } from 'zod';

import { mplusRunBoardSchema } from '../../mplus-runs/dto/mplus-runs-query.dto.js';

/** `GET /pve/mplus-cutoffs?region=us&season=current`: both optional. */
export const mplusCutoffsQuerySchema = mplusRunBoardSchema.pick({ region: true, season: true });

export type MplusCutoffsQuery = z.infer<typeof mplusCutoffsQuerySchema>;
