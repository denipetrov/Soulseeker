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
