import { LOCALES, type Locale } from '../blizzard/blizzard.constants.js';
import type { GameDataIndex } from '../blizzard/game-data.api.js';
import type { NamedEntry } from '../blizzard/schemas/game-data-index.schema.js';
import { nameKey, shortNameKey } from '../common/utils/name-key.js';
import type {
  GameNamesDocument,
  GameNamesResponse,
  LocalizedName,
  LocalizedRaid,
} from './game-names.types.js';

/** A Mythic+ dungeon as `mplus_dungeons` holds it. */
export interface CatalogueDungeon {
  slug: string | null;
  name: string | null;
  challengeModeId: number | null;
}

/** A raid as the catalogue holds it: what a translation is matched to. */
export interface CatalogueRaidNames {
  slug: string;
  name: string;
  encounters: { slug: string; name: string }[];
}

const SUPPORTED = new Set<string>(LOCALES);

/** Only the languages this API offers, empty translations dropped. */
function localized(name: Record<string, string>): LocalizedName {
  return Object.fromEntries(
    Object.entries(name).filter(([locale, value]) => SUPPORTED.has(locale) && value.trim()),
  ) as LocalizedName;
}

const byId = (entries: readonly NamedEntry[]): Record<string, LocalizedName> =>
  Object.fromEntries(entries.map((entry) => [String(entry.id), localized(entry.name)]));

/**
 * Lookup of Blizzard names by English name: the full key first, then the short
 * form (no leading "The", nothing after a comma), as the per-boss kills match.
 */
function byEnglishName(entries: readonly NamedEntry[]) {
  const full = new Map<string, LocalizedName>();
  const short = new Map<string, LocalizedName>();

  for (const entry of entries) {
    const english = entry.name.en_US;
    if (!english) continue;
    const names = localized(entry.name);
    // The first wins: a re-release's journal entry has the same names anyway.
    if (!full.has(nameKey(english))) full.set(nameKey(english), names);
    if (!short.has(shortNameKey(english))) short.set(shortNameKey(english), names);
  }

  const find = (name: string): LocalizedName | null =>
    full.get(nameKey(name)) ?? short.get(shortNameKey(name)) ?? null;

  // A season re-release ("Awakened Amirdrassil", "Fated Castle Nathria") has no
  // journal entry of its own: it takes the original's name, without the prefix.
  return (name: string): LocalizedName | null => {
    const base = name.replace(RERELEASE_PREFIX, '');
    return find(name) ?? (base !== name ? find(base) : null);
  };
}

/** Raider.io's prefix on a season re-release of an older raid and its bosses. */
const RERELEASE_PREFIX = /^(awakened|fated)\s+/i;

/**
 * Every translated name, matched to what this API answers with. Pure: the
 * indexes and the catalogue in, one document out.
 */
export function buildGameNames(
  indexes: Record<GameDataIndex, NamedEntry[]>,
  catalogue: { raids: readonly CatalogueRaidNames[]; dungeons: readonly CatalogueDungeon[] },
  builtAt: Date,
): GameNamesDocument {
  const unmatched: GameNamesDocument['unmatched'] = { dungeons: [], raids: [], bosses: [] };

  // Blizzard's keystone dungeon id is the challenge mode id Rankwarden stores.
  const keystoneDungeons = new Map(
    indexes.keystoneDungeons.map((entry) => [entry.id, localized(entry.name)]),
  );
  const dungeonByName = byEnglishName([...indexes.keystoneDungeons, ...indexes.journalInstances]);
  const dungeons: Record<string, LocalizedName> = {};
  for (const dungeon of catalogue.dungeons) {
    if (!dungeon.slug) continue;
    const names =
      (dungeon.challengeModeId !== null ? keystoneDungeons.get(dungeon.challengeModeId) : null) ??
      (dungeon.name ? dungeonByName(dungeon.name) : null);
    if (names) dungeons[dungeon.slug] = names;
    else unmatched.dungeons.push(dungeon.slug);
  }

  const instanceByName = byEnglishName(indexes.journalInstances);
  const encounterByName = byEnglishName(indexes.journalEncounters);
  const raids: Record<string, LocalizedRaid> = {};
  for (const raid of catalogue.raids) {
    const name = instanceByName(raid.name);
    if (!name) unmatched.raids.push(raid.slug);

    const bosses: Record<string, LocalizedName> = {};
    for (const encounter of raid.encounters) {
      const names = encounterByName(encounter.name);
      if (names) bosses[encounter.slug] = names;
      else unmatched.bosses.push(`${raid.slug}/${encounter.slug}`);
    }
    raids[raid.slug] = { name, bosses };
  }

  return {
    builtAt: builtAt.toISOString(),
    classes: byId(indexes.classes),
    specs: byId(indexes.specializations),
    races: byId(indexes.races),
    heroTalents: byId(indexes.heroTalentTrees),
    affixes: byId(indexes.keystoneAffixes),
    dungeons,
    raids,
    unmatched,
  };
}

/** One language's name, or the English one where Blizzard has no translation. */
const pick = (name: LocalizedName, locale: Locale): string | null =>
  name[locale] ?? name.en_US ?? null;

function pickAll(names: Record<string, LocalizedName>, locale: Locale): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names).flatMap(([key, name]) => {
      const value = pick(name, locale);
      return value ? [[key, value]] : [];
    }),
  );
}

/** One language out of the document. */
export function namesIn(document: GameNamesDocument, locale: Locale): GameNamesResponse {
  return {
    locale,
    builtAt: document.builtAt,
    classes: pickAll(document.classes, locale),
    specs: pickAll(document.specs, locale),
    races: pickAll(document.races, locale),
    heroTalents: pickAll(document.heroTalents, locale),
    affixes: pickAll(document.affixes, locale),
    dungeons: pickAll(document.dungeons, locale),
    raids: Object.fromEntries(
      Object.entries(document.raids).map(([slug, raid]) => [
        slug,
        { name: raid.name ? pick(raid.name, locale) : null, bosses: pickAll(raid.bosses, locale) },
      ]),
    ),
  };
}
