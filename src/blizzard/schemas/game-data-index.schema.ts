import { z } from 'zod';

/**
 * A name as Game Data gives it when asked with no locale: every language at
 * once, `{ en_US: 'Hunter', de_DE: 'Jäger', … }`. A plain string (one locale
 * asked) is accepted too and read as English.
 */
export const localizedNameSchema = z
  .union([z.record(z.string(), z.string().nullable()), z.string()])
  .transform((name): Record<string, string> =>
    typeof name === 'string'
      ? { en_US: name }
      : Object.fromEntries(
          Object.entries(name).filter((entry): entry is [string, string] => Boolean(entry[1])),
        ),
  );

const named = z.looseObject({ id: z.number().int(), name: localizedNameSchema });

export type NamedEntry = z.infer<typeof named>;

export const playableClassIndexSchema = z.looseObject({ classes: z.array(named) });
export const playableSpecializationIndexSchema = z.looseObject({
  character_specializations: z.array(named),
});
export const playableRaceIndexSchema = z.looseObject({ races: z.array(named) });
/** Only the hero talent trees are read; class and spec trees carry no `id` of their own. */
export const talentTreeIndexSchema = z.looseObject({ hero_talent_trees: z.array(named) });
export const keystoneAffixIndexSchema = z.looseObject({ affixes: z.array(named) });
export const keystoneDungeonIndexSchema = z.looseObject({ dungeons: z.array(named) });
export const journalInstanceIndexSchema = z.looseObject({ instances: z.array(named) });
export const journalEncounterIndexSchema = z.looseObject({ encounters: z.array(named) });
