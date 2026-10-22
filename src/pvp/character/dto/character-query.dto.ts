import { z } from 'zod';

import { DEFAULT_LOCALE, LOCALES, REGIONS } from '../../../blizzard/blizzard.constants.js';
import {
  characterNameSchema,
  forceRefreshSchema,
  realmSlugSchema,
} from '../../../characters/dto/character-identity.js';

/**
 * `GET /pvp/character?region=us&realmSlug=demon-soul&characterName=Manongauz&locale=en_US`
 *
 * The three identity fields are all required: a character is only unique by
 * region, realm and name.
 */
export const characterQuerySchema = z.object({
  region: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(REGIONS))
    .meta({ description: 'Blizzard region.', enum: [...REGIONS], example: 'us' }),
  realmSlug: realmSlugSchema,
  characterName: characterNameSchema,
  locale: z
    .enum(LOCALES)
    .default(DEFAULT_LOCALE)
    .meta({ description: 'Language of names, talents and items.', example: 'en_US' }),
  forceRefresh: forceRefreshSchema,
});

export type CharacterQuery = z.infer<typeof characterQuerySchema>;
