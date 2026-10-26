import { z } from 'zod';

import {
  characterNameSchema,
  forceRefreshSchema,
  realmSlugSchema,
} from '../../../characters/dto/character-identity.js';
import { RAIDERIO_REGIONS } from '../../../raiderio/raiderio.constants.js';

/** A raid or season slug: `tier-mn-1`, `season-mn-2`. Checked against the catalogue later. */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug, e.g. "season-mn-2"')
  .max(80);

/**
 * `GET /pve/character?region=us&realmSlug=demon-soul&characterName=Manongauz`
 *
 * Without `raidProgression` or `mplusSeasonScore`, the whole page. With either
 * or both, only those: a widget that shows one raid or one season asks for
 * just that. Raider.io answers in English only, so there is no locale.
 */
export const pveCharacterQuerySchema = z.object({
  region: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(RAIDERIO_REGIONS))
    .meta({ description: 'Region.', enum: [...RAIDERIO_REGIONS], example: 'us' }),
  realmSlug: realmSlugSchema,
  characterName: characterNameSchema,
  raidProgression: slug.optional().meta({
    description:
      'A raid slug from the catalogue: only that raid’s progression and its AOTC / Cutting ' +
      'Edge dates.',
    example: 'tier-mn-1',
  }),
  mplusSeasonScore: slug.optional().meta({
    description: 'A Mythic+ season slug from the catalogue: only that season’s scores.',
    example: 'season-mn-2',
  }),
  forceRefresh: forceRefreshSchema,
});

export type PveCharacterQuery = z.infer<typeof pveCharacterQuerySchema>;
