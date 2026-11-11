import type { CharacterProfile } from '../../characters/entities/character.entity.js';
import { slugOf } from '../leaderboard/leaderboard.mapper.js';
import type { HeroTalentUse, SpecHeroTalents } from './hero-talents.types.js';

/** A hero talent tree, as the profile names it. */
export interface Tree {
  id: number;
  name: string;
}

/** The part of a profile the tree is read from. */
export type TreeProfile = Pick<CharacterProfile, 'heroTalentTree' | 'talentLoadouts'>;

/**
 * The hero talent tree a character plays on one ladder, or null when it is not
 * known yet.
 *
 * On Shuffle and Blitz — one ladder per spec — the loadout of the ladder's own
 * spec, never the active spec's: a Fury warrior's tree says nothing about
 * their Arms ladder (Rankwarden handbook, "Rules for readers"). On 2v2, 3v3
 * and RBG the active spec's, which is also the spec the row is counted for.
 */
export function treeOf(
  profile: TreeProfile | undefined,
  spec: string,
  perSpec: boolean,
): Tree | null {
  if (!profile) return null;

  const tree = perSpec
    ? profile.talentLoadouts?.find((loadout) => slugOf(loadout.spec?.name) === spec)?.heroTalentTree
    : profile.heroTalentTree;

  return tree?.id !== undefined && tree.name ? { id: tree.id, name: tree.name } : null;
}

const round4 = (value: number) => Number(value.toFixed(4));

/**
 * One spec's figures from its top characters: their ratings, and each
 * character's tree or null when not known. Trees most played first; equal
 * counts by id, so the order never depends on the read's.
 */
export function specStats(
  spec: string,
  characters: readonly { rating: number; tree: Tree | null }[],
): SpecHeroTalents {
  const trees = new Map<number, HeroTalentUse>();
  let covered = 0;

  for (const { tree } of characters) {
    if (!tree) continue;
    covered += 1;
    const use = trees.get(tree.id) ?? { id: tree.id, name: tree.name, count: 0, share: 0 };
    use.count += 1;
    trees.set(tree.id, use);
  }

  const ratings = characters.map((character) => character.rating);

  return {
    spec,
    characters: characters.length,
    covered,
    minRating: ratings.length ? Math.min(...ratings) : null,
    maxRating: ratings.length ? Math.max(...ratings) : null,
    heroTalents: [...trees.values()]
      .map((use) => ({ ...use, share: round4(use.count / covered) }))
      .sort((a, b) => b.count - a.count || a.id - b.id),
  };
}
