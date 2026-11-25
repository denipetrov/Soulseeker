import { z } from 'zod';

import { DEFAULT_LOCALE, LOCALES } from '../../blizzard/blizzard.constants.js';

/**
 * `GET /i18n/names?locale=de_DE`
 *
 * `locale` is one of Blizzard's (`LOCALES`), in Blizzard's spelling. `de-de`
 * and `DE_de` are read as `de_DE`.
 */
export const gameNamesQuerySchema = z.object({
  locale: z
    .string()
    .trim()
    .transform((value) => {
      const [language = '', country = ''] = value.replace('-', '_').split('_');
      return `${language.toLowerCase()}_${country.toUpperCase()}`;
    })
    .pipe(z.enum(LOCALES))
    .default(DEFAULT_LOCALE)
    .meta({
      description: 'The language, as Blizzard spells it. Defaults to `en_US`.',
      enum: [...LOCALES],
      example: 'de_DE',
    }),
});
export type GameNamesQuery = z.infer<typeof gameNamesQuerySchema>;
