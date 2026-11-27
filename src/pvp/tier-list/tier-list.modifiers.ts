import type { Role } from '../roles.js';

/**
 * How one role's specs are scored on a ladder: the three factors' points are
 * multiplied by `factor`.
 *
 * `placedAgainstOthers` makes the role's specs earn their tier: the S–D lines
 * are drawn over every spec as usual, then such a spec gets no better than the
 * best tier whose other specs' average it reaches, D when it reaches none. Without it, a role filling the bottom would spill into C once
 * D's share is full.
 */
export interface RoleModifier {
  factor: number;
  placedAgainstOthers?: boolean;
}

export type RoleModifiers = Partial<Record<Role, RoleModifier>>;

/**
 * Arena tanks (2v2, 3v3, Solo Shuffle). Few play a tank in arena, and the few
 * that do are rarely there for the tank's strength: halved, and made to earn
 * its tier, a tank stays in D unless it scores, before the cut, about twice
 * what a typical C spec does: an outlier.
 */
export const ARENA_TANK: RoleModifier = { factor: 0.5, placedAgainstOthers: true };

/**
 * Battleground tanks (RBG, Blitz). A team fields one, against five or six
 * damage dealers, and tanks carry the flag: a tank spec is far less
 * represented than it is strong.
 */
export const BATTLEGROUND_TANK: RoleModifier = { factor: 1.3 };

/**
 * Battleground healers (RBG, Blitz). A team fields two or three. Per spec that
 * is already more seats than a damage dealer gets (seven healer specs share
 * them, 27 damage specs share five or six), so the boost is a light one.
 */
export const BATTLEGROUND_HEALER: RoleModifier = { factor: 1.1 };

/** Each PvP ladder family's role modifiers; a role not listed is scored as it is. */
export const PVP_ROLE_MODIFIERS: Readonly<Record<string, RoleModifiers>> = {
  '2v2': { tank: ARENA_TANK },
  '3v3': { tank: ARENA_TANK },
  shuffle: { tank: ARENA_TANK },
  rbg: { tank: BATTLEGROUND_TANK, healer: BATTLEGROUND_HEALER },
  blitz: { tank: BATTLEGROUND_TANK, healer: BATTLEGROUND_HEALER },
};
