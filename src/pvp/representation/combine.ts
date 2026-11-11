import type {
  HeroTalentShare,
  SpecRepresentationDocument,
  SpecShare,
} from '../entities/spec-representation.entity.js';

const round4 = (value: number) => Number(value.toFixed(4));

/** What a day's figures are, once several regions' snapshots are one. */
export type CombinedSnapshot = Pick<
  SpecRepresentationDocument,
  'total' | 'classified' | 'specs' | 'computedAt'
>;

/**
 * Several regions' snapshots of one day as one, for `world`.
 *
 * Counts add up — `total`, `classified`, each spec's `count` and
 * `heroTalentsClassified`, each hero talent tree's `count` — and the shares
 * are worked out again from the sums, never averaged: a region with ten times
 * the players weighs ten times as much. `computedAt` is the latest of them.
 * Specs come most played first. One snapshot is returned as it is.
 */
export function combineSnapshots(snapshots: readonly CombinedSnapshot[]): CombinedSnapshot {
  if (snapshots.length === 1) return snapshots[0]!;

  const specs = new Map<string, SpecShare & { trees: Map<number, HeroTalentShare> }>();
  let total = 0;
  let classified = 0;
  let computedAt = 0;

  for (const snapshot of snapshots) {
    total += snapshot.total;
    classified += snapshot.classified;
    computedAt = Math.max(computedAt, new Date(snapshot.computedAt).getTime());

    for (const share of snapshot.specs ?? []) {
      const key = `${share.class}-${share.spec}`;
      let into = specs.get(key);
      if (!into) {
        into = {
          ...share,
          count: 0,
          share: 0,
          heroTalentsClassified: 0,
          heroTalents: [],
          trees: new Map(),
        };
        specs.set(key, into);
      }
      into.count += share.count;
      into.heroTalentsClassified += share.heroTalentsClassified ?? 0;

      for (const tree of share.heroTalents ?? []) {
        const known = into.trees.get(tree.id);
        if (known) known.count += tree.count;
        else into.trees.set(tree.id, { ...tree });
      }
    }
  }

  return {
    total,
    classified,
    computedAt: new Date(computedAt),
    specs: [...specs.values()]
      .map(({ trees, ...share }) => ({
        ...share,
        share: classified ? round4(share.count / classified) : 0,
        heroTalents: [...trees.values()]
          .sort((a, b) => b.count - a.count)
          .map((tree) => ({
            ...tree,
            share: share.heroTalentsClassified
              ? round4(tree.count / share.heroTalentsClassified)
              : 0,
          })),
      }))
      .sort((a, b) => b.count - a.count),
  };
}
