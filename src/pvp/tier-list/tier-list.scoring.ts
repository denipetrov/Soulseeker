import type { Tier, TierListSpec } from './tier-list.types.js';

/** The rating representation and average rating count from: rows at or above it. */
export const MIN_RATING = 1_500;

/**
 * How many phantom players at `MIN_RATING` each spec's average is taken with,
 * so the number of players behind an average counts as well as its value:
 * `(count × average + 50 × 1500) / (count + 50)`. 1,000 players at 1800 stay
 * ~1786; 5 at 1800 fall to ~1527. Every row is at or above 1500, so more
 * players always helps. 50 keeps a 3v3 spec (~80 rows) mostly its own and
 * pulls a Shuffle tank spec (~20 rows) most of the way down.
 */
export const AVERAGE_RATING_PRIOR_WEIGHT = 50;

/** A spec's average rating, pulled toward `MIN_RATING` by how few players it has. */
export function adjustedAverage(count: number, average: number): number {
  return (
    (count * average + AVERAGE_RATING_PRIOR_WEIGHT * MIN_RATING) /
    (count + AVERAGE_RATING_PRIOR_WEIGHT)
  );
}

/** Points each factor is worth; they add up to 100. */
export const FACTOR_POINTS = { topDensity: 45, representation: 35, averageRating: 20 } as const;

/** The ladder's top bands, each band's weight within the density. Cumulative: the top 500 holds the top 250. */
export const DENSITY_BANDS = [
  { top: 250, weight: 0.3 },
  { top: 500, weight: 0.25 },
  { top: 1_000, weight: 0.2 },
  { top: 2_500, weight: 0.15 },
  { top: 5_000, weight: 0.1 },
] as const;

/** Rows the density reads: the deepest band. */
export const TOP_ROWS = DENSITY_BANDS.at(-1)!.top;

/**
 * Each tier and the share of specs, best first, it reaches down to: the
 * baseline of its lower line, which `assignTiers` may move by up to
 * `TIER_LINE_SLACK` specs.
 */
export const TIERS: readonly { tier: Tier; upTo: number }[] = [
  { tier: 'S', upTo: 0.1 },
  { tier: 'A', upTo: 0.35 },
  { tier: 'B', upTo: 0.65 },
  { tier: 'C', upTo: 0.9 },
  { tier: 'D', upTo: 1 },
];

export interface SpecRef {
  class: string | null;
  spec: string | null;
}

/** One spec's rows at or above the minimum rating. */
export interface SpecGroup {
  class: string;
  spec: string;
  count: number;
  averageRating: number;
}

const round = (value: number, places: number) => Number(value.toFixed(places));
const keyOf = (ref: { class: string; spec: string }) => `${ref.class}-${ref.spec}`;

/**
 * `points` split by order: the highest value gets all of them, the lowest
 * none, the rest evenly between. Equal values share the mean of the places
 * they hold, so a tie never favours whichever came first.
 *
 * Null — a spec with no rows at all — gets nothing, and does not share the
 * bottom places with its fellows: the places are still spread over every
 * value, so the lowest spec with rows keeps a little more than none.
 */
export function rankPoints(values: readonly (number | null)[], points: number): number[] {
  const n = values.length;
  if (n === 1) return [values[0] === null ? 0 : points];

  const order = values
    .map((value, index) => ({ value: value ?? -Infinity, index }))
    .sort((a, b) => b.value - a.value);

  const result = new Array<number>(n);
  for (let start = 0; start < n;) {
    let end = start;
    while (end + 1 < n && order[end + 1]!.value === order[start]!.value) end++;

    const place = (start + end) / 2;
    for (let i = start; i <= end; i++) {
      const { index } = order[i]!;
      result[index] = values[index] === null ? 0 : (points * (n - 1 - place)) / (n - 1);
    }
    start = end + 1;
  }

  return result;
}

/** How many specs a tier line may move up or down from its baseline. */
export const TIER_LINE_SLACK = 2;

const GAP_EPSILON = 1e-9;

/**
 * The tier of each spec, for scores best first.
 *
 * Each line between two tiers starts at its baseline, `round(n × upTo)` specs
 * from the top, and moves — by up to `TIER_LINE_SLACK` specs either way — to
 * where the scores drop the most: the widest gap between two neighbours in
 * that window. Specs close to each other then share a tier, and a line falls
 * where the list itself breaks. A tie between gaps goes to the one nearer the
 * baseline, then the higher. A line stays below the one above it and above
 * the next one's baseline, so a tier is empty only when its baseline is.
 */
export function assignTiers(scores: readonly number[]): Tier[] {
  const n = scores.length;
  // cuts[k]: how many specs are above line k, the line under TIERS[k].
  const cuts: number[] = [];

  const baselines = TIERS.map(({ upTo }) => Math.round(n * upTo));

  TIERS.slice(0, -1).forEach((_, k) => {
    const baseline = baselines[k]!;
    const above = cuts[k - 1] ?? 0;

    // A baseline that leaves the tier empty (a short list) stays as it is.
    if (baseline <= above || baseline >= n) {
      cuts.push(Math.max(baseline, above));
      return;
    }

    let best = baseline;
    let bestGap = scores[baseline - 1]! - scores[baseline]!;
    const low = Math.max(baseline - TIER_LINE_SLACK, above + 1);
    // Short of the next line's baseline, so the tier below keeps a spec.
    const high = Math.min(baseline + TIER_LINE_SLACK, n - 1, baselines[k + 1]! - 1);
    for (let cut = low; cut <= high; cut++) {
      const gap = scores[cut - 1]! - scores[cut]!;
      const distance = Math.abs(cut - baseline);
      const bestDistance = Math.abs(best - baseline);
      // Sums of fractions: gaps that are equal can differ in the last bits.
      const wider = gap > bestGap + GAP_EPSILON;
      const equal = Math.abs(gap - bestGap) <= GAP_EPSILON;
      if (
        wider ||
        (equal && (distance < bestDistance || (distance === bestDistance && cut < best)))
      ) {
        best = cut;
        bestGap = gap;
      }
    }
    cuts.push(best);
  });

  return scores.map((_, index) => {
    const k = cuts.findIndex((cut) => index < cut);
    return TIERS[k === -1 ? TIERS.length - 1 : k]!.tier;
  });
}

/**
 * The tier list of one ladder.
 *
 * - **Top tier density (45)**: per band, the spec's rows over the most any
 *   spec has in that band, weighted by the band and added up — the spec that
 *   leads every band gets all 45.
 * - **Representation (35)**: by order of the spec's count at or above the
 *   minimum, as `rankPoints`.
 * - **Average rating (20)**: by order of the spec's mean rating there, taken
 *   with its count by `adjustedAverage`, so a handful of players does not
 *   outrank a spec of thousands at a similar average.
 *
 * Specs are `specs` — every one listed is scored, one with no rows getting 0
 * on each factor — and any other seen in either read. `top` is the ladder best
 * first, one entry per row, null for a row whose spec is not known yet: it
 * holds its place but counts for nobody.
 *
 * Empty when no row has a spec: there is nothing to rank by.
 */
export function scoreTierList(
  top: readonly SpecRef[],
  groups: readonly SpecGroup[],
  specs: readonly { class: string; spec: string }[] = [],
): TierListSpec[] {
  if (groups.length === 0 && !top.some((row) => row.class && row.spec)) return [];

  const entries = new Map<string, { class: string; spec: string; bands: number[] }>();
  const entry = (cls: string, spec: string) => {
    const key = keyOf({ class: cls, spec });
    let found = entries.get(key);
    if (!found) {
      found = { class: cls, spec, bands: DENSITY_BANDS.map(() => 0) };
      entries.set(key, found);
    }
    return found;
  };
  for (const listed of specs) entry(listed.class, listed.spec);

  top.slice(0, TOP_ROWS).forEach((row, position) => {
    if (!row.class || !row.spec) return;
    const { bands } = entry(row.class, row.spec);
    DENSITY_BANDS.forEach(({ top: size }, band) => {
      if (position < size) bands[band]!++;
    });
  });

  const byKey = new Map(groups.map((group) => [keyOf(group), group]));
  for (const group of groups) entry(group.class, group.spec);

  const list = [...entries.values()];

  const bandMax = DENSITY_BANDS.map((_, band) => Math.max(...list.map((s) => s.bands[band]!)));
  const classified = groups.reduce((sum, group) => sum + group.count, 0);
  const groupOf = (s: { class: string; spec: string }) => byKey.get(keyOf(s));

  const representation = rankPoints(
    list.map((s) => groupOf(s)?.count ?? null),
    FACTOR_POINTS.representation,
  );
  const averageRating = rankPoints(
    list.map((s) => {
      const group = groupOf(s);
      return group ? adjustedAverage(group.count, group.averageRating) : null;
    }),
    FACTOR_POINTS.averageRating,
  );

  const scored = list.map((s, i) => {
    const density = DENSITY_BANDS.reduce(
      (sum, { weight }, band) =>
        sum + (bandMax[band] ? (weight * s.bands[band]!) / bandMax[band] : 0),
      0,
    );
    const densityPoints = density * FACTOR_POINTS.topDensity;
    const group = groupOf(s);
    const [top250, top500, top1000, top2500, top5000] = s.bands as [
      number,
      number,
      number,
      number,
      number,
    ];

    return {
      raw: densityPoints + representation[i]! + averageRating[i]!,
      spec: {
        class: s.class,
        spec: s.spec,
        tier: 'D' as Tier,
        score: 0,
        topDensity: { top250, top500, top1000, top2500, top5000, score: round(densityPoints, 2) },
        representation: {
          count: group?.count ?? 0,
          share: classified ? round((group?.count ?? 0) / classified, 4) : 0,
          score: round(representation[i]!, 2),
        },
        averageRating: {
          value: group ? round(group.averageRating, 1) : null,
          adjusted: group ? round(adjustedAverage(group.count, group.averageRating), 1) : null,
          score: round(averageRating[i]!, 2),
        },
      },
    };
  });

  // Best first; a tie falls back to the slug, so the order never depends on Mongo's.
  scored.sort((a, b) => b.raw - a.raw || keyOf(a.spec).localeCompare(keyOf(b.spec)));

  const tiers = assignTiers(scored.map(({ raw }) => raw));

  return scored.map(({ raw, spec }, index) => ({
    ...spec,
    tier: tiers[index]!,
    score: round(raw, 2),
  }));
}
