import type { Locale } from '../blizzard/blizzard.constants.js';

/** One name in every language Blizzard has it in: `{ en_US: 'Hunter', de_DE: 'Jäger', … }`. */
export type LocalizedName = Partial<Record<Locale, string>>;

/** A raid's name and its bosses' names, the bosses by their catalogue slug. */
export interface LocalizedRaid {
  name: LocalizedName | null;
  bosses: Record<string, LocalizedName>;
}

/**
 * Every translated name, in every language, as one Redis value. Built from
 * Blizzard's Game Data indexes and matched to what this API answers with:
 * Blizzard's ids for classes, specs, races, hero talent trees and affixes; the
 * catalogue's slugs for dungeons, raids and bosses.
 */
export interface GameNamesDocument {
  builtAt: string;
  classes: Record<string, LocalizedName>;
  specs: Record<string, LocalizedName>;
  races: Record<string, LocalizedName>;
  heroTalents: Record<string, LocalizedName>;
  affixes: Record<string, LocalizedName>;
  /** By dungeon slug, matched on `challengeModeId` (Blizzard's keystone dungeon id). */
  dungeons: Record<string, LocalizedName>;
  /** By raid slug, matched on the English name in Blizzard's encounter journal. */
  raids: Record<string, LocalizedRaid>;
  /** What found no Blizzard name, for the log: the front end shows the English name there. */
  unmatched: { dungeons: string[]; raids: string[]; bosses: string[] };
}

/** One language's names, as `GET /i18n/names` answers them. */
export interface GameNamesResponse {
  locale: Locale;
  /** When the names were read from Blizzard; a new value means the front end's copy is old. */
  builtAt: string;
  /** By Blizzard class id, as `classId` in every answer. */
  classes: Record<string, string>;
  /** By Blizzard spec id, as `specId`. */
  specs: Record<string, string>;
  /** By Blizzard race id, as `raceId`. */
  races: Record<string, string>;
  /** By Blizzard hero talent tree id, as `heroTalentId` and hero talent `id`s. */
  heroTalents: Record<string, string>;
  /** By keystone affix id, as `affixIds` and `/pve/mplus-seasons`' affixes. */
  affixes: Record<string, string>;
  /** By dungeon slug. */
  dungeons: Record<string, string>;
  /** By raid slug, each with its bosses by boss slug. */
  raids: Record<string, { name: string | null; bosses: Record<string, string> }>;
}
