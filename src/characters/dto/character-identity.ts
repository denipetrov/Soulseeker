import { z } from 'zod';

/** Blizzard's limits on a character name, in characters (not bytes: names carry accents). */
const NAME_MIN = 2;
const NAME_MAX = 12;

/** A realm slug, lowercased: `demon-soul`. */
export const realmSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a realm slug, e.g. "demon-soul"')
  .max(64)
  .meta({ description: 'Realm slug.', example: 'demon-soul' });

/**
 * A character name, NFC-normalised and lowercased. It keeps its accents, which
 * Blizzard and Raider.io both need, and is lowercased since both treat names
 * case-blind, and so does the cache.
 */
export const characterNameSchema = z
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
  .meta({ description: 'Character name, any case.', example: 'Manongauz' });

/** `forceRefresh=true|false`, default false. */
export const forceRefreshSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')
  .meta({
    description:
      'Skip the cache and ask upstream again. Honoured once per character every few ' +
      'minutes; otherwise the cached page is served.',
  });
