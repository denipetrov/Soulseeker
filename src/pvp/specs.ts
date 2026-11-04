import { CLASSES } from './leaderboard/dto/leaderboard-query.dto.js';

/**
 * Every spec of every class, as the ratings rows and ladder names spell them.
 *
 * The list a tier list is drawn from: each of these appears on it, whether or
 * not any row has it. Keep it in step with the game. A spec Blizzard adds
 * still shows up from the data (and is logged) until it is added here.
 */
export const SPECS_BY_CLASS: Record<(typeof CLASSES)[number], readonly string[]> = {
  deathknight: ['blood', 'frost', 'unholy'],
  demonhunter: ['devourer', 'havoc', 'vengeance'],
  druid: ['balance', 'feral', 'guardian', 'restoration'],
  evoker: ['augmentation', 'devastation', 'preservation'],
  hunter: ['beastmastery', 'marksmanship', 'survival'],
  mage: ['arcane', 'fire', 'frost'],
  monk: ['brewmaster', 'mistweaver', 'windwalker'],
  paladin: ['holy', 'protection', 'retribution'],
  priest: ['discipline', 'holy', 'shadow'],
  rogue: ['assassination', 'outlaw', 'subtlety'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  warlock: ['affliction', 'demonology', 'destruction'],
  warrior: ['arms', 'fury', 'protection'],
};

/** `SPECS_BY_CLASS` flattened: 40 class and spec pairs, by class. */
export const ALL_SPECS: readonly { class: string; spec: string }[] = CLASSES.flatMap((cls) =>
  SPECS_BY_CLASS[cls].map((spec) => ({ class: cls, spec })),
);

/** Blizzard's class id per class slug, as `profile.classId` stores it on Mythic+ characters. */
export const CLASS_IDS: Record<(typeof CLASSES)[number], number> = {
  warrior: 1,
  paladin: 2,
  hunter: 3,
  rogue: 4,
  priest: 5,
  deathknight: 6,
  shaman: 7,
  mage: 8,
  warlock: 9,
  monk: 10,
  druid: 11,
  demonhunter: 12,
  evoker: 13,
};

/**
 * Blizzard's specialization id per `class-spec` slug pair, as `profile.specId`
 * stores it on Mythic+ characters. Checked against every spec in
 * `mplus_characters` (2026-11-04).
 */
export const SPEC_IDS: Record<string, number> = {
  'deathknight-blood': 250,
  'deathknight-frost': 251,
  'deathknight-unholy': 252,
  'demonhunter-havoc': 577,
  'demonhunter-vengeance': 581,
  'demonhunter-devourer': 1480,
  'druid-balance': 102,
  'druid-feral': 103,
  'druid-guardian': 104,
  'druid-restoration': 105,
  'evoker-devastation': 1467,
  'evoker-preservation': 1468,
  'evoker-augmentation': 1473,
  'hunter-beastmastery': 253,
  'hunter-marksmanship': 254,
  'hunter-survival': 255,
  'mage-arcane': 62,
  'mage-fire': 63,
  'mage-frost': 64,
  'monk-brewmaster': 268,
  'monk-windwalker': 269,
  'monk-mistweaver': 270,
  'paladin-holy': 65,
  'paladin-protection': 66,
  'paladin-retribution': 70,
  'priest-discipline': 256,
  'priest-holy': 257,
  'priest-shadow': 258,
  'rogue-assassination': 259,
  'rogue-outlaw': 260,
  'rogue-subtlety': 261,
  'shaman-elemental': 262,
  'shaman-enhancement': 263,
  'shaman-restoration': 264,
  'warlock-affliction': 265,
  'warlock-demonology': 266,
  'warlock-destruction': 267,
  'warrior-arms': 71,
  'warrior-fury': 72,
  'warrior-protection': 73,
};
