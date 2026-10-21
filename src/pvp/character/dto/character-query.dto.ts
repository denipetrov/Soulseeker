import { z } from 'zod';

import { DEFAULT_LOCALE, LOCALES, REGIONS } from '../../../blizzard/blizzard.constants.js';

/** Blizzard's limits on a character name, in characters (not bytes: names carry accents). */
const NAME_MIN = 2;
const NAME_MAX = 12;

/**
 * `GET /pvp/character?region=us&realmSlug=demon-soul&characterName=Manongauz&locale=en_US`
 *
 * The three identity fields are all required: a character is only unique by
 * region, realm and name. The name keeps its accents (Blizzard needs them) and
 * is lowercased, since Blizzard and the cache both treat names case-blind.
 */
export const characterQuerySchema = z.object({
  region: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(REGIONS))
    .meta({ description: 'Blizzard region.', enum: [...REGIONS], example: 'us' }),
  realmSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a realm slug, e.g. "demon-soul"')
    .max(64)
    .meta({ description: 'Realm slug.', example: 'demon-soul' }),
  characterName: z
    .string()
    .trim()
    .transform((name) => name.normalize('NFC').toLowerCase())
    .pipe(
      z
        .string()
        .regex(/^\p{L}+$/u, 'must be letters only')
        .refine(
          (name) => [...name].length >= NAME_MIN && [...name].length <= NAME_MAX,
          `must be ${NAME_MIN} to ${NAME_MAX} letters`,
        ),
    )
    .meta({ description: 'Character name, any case.', example: 'Manongauz' }),
  locale: z
    .enum(LOCALES)
    .default(DEFAULT_LOCALE)
    .meta({ description: 'Language of names, talents and items.', example: 'en_US' }),
  forceRefresh: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .meta({
      description:
        'Skip the cache and ask Blizzard again. Honoured once per character every few ' +
        'minutes; otherwise the cached page is served.',
    }),
});

export type CharacterQuery = z.infer<typeof characterQuerySchema>;
