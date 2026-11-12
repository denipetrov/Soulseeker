import { classSlugOf, specSlugOf } from '../../pvp/specs.js';
import type { MplusRunMember } from '../mplus-runs/mplus-runs.types.js';
import type { Composition, CompositionMember } from './mplus-compositions.types.js';

/** Compositions answered: the most played. */
export const TOP_COMPOSITIONS = 50;

/** The part of a roster member a composition is made of. */
export type RosterSlot = Pick<
  MplusRunMember,
  'classId' | 'className' | 'specId' | 'specName' | 'role'
>;

const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

const byRoleThenId = (a: RosterSlot, b: RosterSlot) =>
  (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) ||
  a.classId - b.classId ||
  (a.specId ?? 0) - (b.specId ?? 0);

const memberOf = (slot: RosterSlot): CompositionMember => ({
  class: classSlugOf(slot.classId),
  spec: specSlugOf(slot.specId),
  classId: slot.classId,
  className: slot.className,
  specId: slot.specId ?? null,
  specName: slot.specName ?? null,
  role: slot.role,
});

/**
 * The most played compositions among some runs, most played first.
 *
 * A composition is the party's class and spec pairs, whoever played them and
 * in whatever order the roster lists them: each roster is sorted — tank,
 * healer, damage dealers, then by class and spec id — and runs with the same
 * sorted pairs are one composition. Equal counts keep the order in which the
 * composition first appears among the runs, which are best first: the one
 * with the better run ranks higher.
 */
export function topCompositions(
  rosters: readonly (readonly RosterSlot[])[],
  limit = TOP_COMPOSITIONS,
): Composition[] {
  const found = new Map<string, { count: number; members: RosterSlot[] }>();

  for (const roster of rosters) {
    const members = [...roster].sort(byRoleThenId);
    const key = members.map((m) => `${m.classId}:${m.specId ?? '-'}`).join('|');
    const entry = found.get(key);
    if (entry) entry.count += 1;
    else found.set(key, { count: 1, members });
  }

  // A stable sort: Map keeps first appearance, so ties stay in run order.
  return [...found.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ count, members }, i) => ({
      rank: i + 1,
      count,
      share: rosters.length ? Number((count / rosters.length).toFixed(4)) : 0,
      members: members.map(memberOf),
    }));
}
