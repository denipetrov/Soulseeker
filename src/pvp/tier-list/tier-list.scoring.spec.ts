import { describe, expect, it } from 'vitest';

import {
  adjustedAverage,
  assignTiersAround,
  rankPoints,
  scoreTierList,
  assignTiers,
  type SpecGroup,
  type SpecRef,
} from './tier-list.scoring.js';
import { PVP_ROLE_MODIFIERS } from './tier-list.modifiers.js';

const ref = (cls: string | null, spec: string | null): SpecRef => ({ class: cls, spec });
const rows = (count: number, cls: string, spec: string) =>
  Array.from({ length: count }, () => ref(cls, spec));
const group = (cls: string, spec: string, count: number, averageRating: number): SpecGroup => ({
  class: cls,
  spec,
  count,
  averageRating,
});

describe('rankPoints', () => {
  it('gives the highest all the points, the lowest none, the rest evenly between', () => {
    expect(rankPoints([10, 30, 20], 35)).toEqual([0, 35, 17.5]);
  });

  it('lets a tie share the mean of the places it holds, and ranks null last', () => {
    expect(rankPoints([5, 5, 1, null], 30)).toEqual([25, 25, 10, 0]);
  });

  it('gives null nothing, without sharing the bottom places', () => {
    // Three specs: 3 holds place 0, 1 place 1 of the 0–2 spread; both nulls 0.
    expect(rankPoints([null, 3, null, 1], 30)).toEqual([0, 30, 0, 20]);
  });

  it('gives a lone spec all the points, unless it has none', () => {
    expect(rankPoints([3], 20)).toEqual([20]);
    expect(rankPoints([null], 20)).toEqual([0]);
  });
});

describe('adjustedAverage', () => {
  it('lets the number of players count: 1,000 at 1800 stay near it, 5 fall toward 1500', () => {
    expect(adjustedAverage(1000, 1800)).toBeCloseTo(1785.7, 1);
    expect(adjustedAverage(5, 1800)).toBeCloseTo(1527.3, 1);
  });

  it('pulls toward the floor given: 2000 on Mythic+', () => {
    expect(adjustedAverage(50, 3800, 2000)).toBe(2900);
  });
});

describe('assignTiers', () => {
  const sizes = (tiers: string[]) =>
    Object.fromEntries(
      ['S', 'A', 'B', 'C', 'D'].map((t) => [t, tiers.filter((x) => x === t).length]),
    );
  /** 40 specs a point apart, with the given drops: `{ 4: 10 }` puts 10 between the 4th and 5th. */
  const ladder = (drops: Record<number, number> = {}) => {
    let score = 100;
    return Array.from({ length: 40 }, (_, i) => (score -= i === 0 ? 0 : 1 + (drops[i] ?? 0)));
  };

  it('keeps the 10 / 25 / 30 / 25 / 10 percent baselines on an even list', () => {
    expect(sizes(assignTiers(ladder()))).toEqual({ S: 4, A: 10, B: 12, C: 10, D: 4 });
  });

  it('moves a line to the widest drop within two specs of it', () => {
    // Specs 4 and 5 (0-based) close to the S line; the list breaks after the 5th.
    expect(sizes(assignTiers(ladder({ 5: 10 })))).toEqual({ S: 5, A: 9, B: 12, C: 10, D: 4 });
    expect(sizes(assignTiers(ladder({ 2: 10 })))).toEqual({ S: 2, A: 12, B: 12, C: 10, D: 4 });
  });

  it('does not move a line further than two specs', () => {
    expect(sizes(assignTiers(ladder({ 7: 30 })))).toEqual({ S: 4, A: 10, B: 12, C: 10, D: 4 });
  });

  it('prefers the baseline, then the nearer, then the higher of equal drops', () => {
    expect(sizes(assignTiers(ladder({ 3: 5, 5: 5 })))).toEqual({ S: 3, A: 11, B: 12, C: 10, D: 4 });
    expect(sizes(assignTiers(ladder({ 4: 5, 6: 5 })))).toEqual({ S: 4, A: 10, B: 12, C: 10, D: 4 });
  });

  it('keeps equal scores in one tier when a drop is in reach', () => {
    // Six level at 90, then the rest from 84 down: the S line goes past its baseline of 4.
    const scores = [
      ...Array.from({ length: 6 }, () => 90),
      ...ladder()
        .slice(6)
        .map((x) => x - 10),
    ];
    expect(sizes(assignTiers(scores)).S).toBe(6);
  });

  it('never empties a tier on a short list', () => {
    // Five specs: lines at 1, 2, 3 and 5, so D is empty; the drop after the third cannot
    // pull a line past the next one's baseline.
    expect(assignTiers([100, 99, 98, 50, 49])).toEqual(['S', 'A', 'B', 'C', 'C']);
  });
});

describe('scoreTierList', () => {
  it('gives all 100 points to the spec that leads every factor', () => {
    const top = [...rows(250, 'priest', 'discipline'), ...rows(250, 'mage', 'fire')];
    const [first, second] = scoreTierList(top, [
      group('priest', 'discipline', 900, 2100),
      group('mage', 'fire', 100, 1900),
    ]);

    expect(first).toMatchObject({
      class: 'priest',
      spec: 'discipline',
      score: 100,
      topDensity: { top250: 250, top500: 250, top1000: 250, top2500: 250, top5000: 250, score: 45 },
      representation: { count: 900, share: 0.9, score: 35 },
      averageRating: { value: 2100, score: 20 },
    });
    // Fire has none of the top 250, all of its band past it: 0.25 + 0.20 + 0.15 + 0.10 of 45.
    expect(second!.topDensity).toMatchObject({ top250: 0, top500: 250, score: 31.5 });
    expect(second!.score).toBe(31.5);
  });

  it('weighs each band against the spec that leads it', () => {
    // Top 250: arms 200, fire 50. Below: fire only.
    const top = [...rows(200, 'warrior', 'arms'), ...rows(300, 'mage', 'fire')];
    const list = scoreTierList(top, []);
    const arms = list.find((s) => s.spec === 'arms')!;
    const fire = list.find((s) => s.spec === 'fire')!;

    // Arms leads the top 250 (0.30); in the top 500 and deeper, 200 of fire's 300.
    expect(arms.topDensity.score).toBeCloseTo(45 * (0.3 + (0.7 * 200) / 300), 1);
    // Fire: 50 of 200 in the top 250, then leads every band.
    expect(fire.topDensity.score).toBeCloseTo(45 * ((0.3 * 50) / 200 + 0.7), 1);
  });

  it('lets an unclassified row hold its place without counting for anyone', () => {
    const top = [...rows(250, 'x', 'y').map(() => ref(null, null)), ...rows(10, 'mage', 'fire')];
    const [fire] = scoreTierList(top, [group('mage', 'fire', 10, 2000)]);

    expect(fire!.topDensity).toMatchObject({ top250: 0, top500: 10 });
  });

  it('keeps a spec seen only in the top rows, with no average rating', () => {
    const list = scoreTierList(rows(5, 'druid', 'balance'), [group('mage', 'fire', 10, 1600)]);
    const balance = list.find((s) => s.spec === 'balance')!;

    expect(balance.representation).toEqual({ count: 0, share: 0, score: 0 });
    expect(balance.averageRating).toEqual({ value: null, adjusted: null, score: 0 });
  });

  it('orders by score, a tie by slug, and assigns tiers by place', () => {
    const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((spec, i) =>
      group('mage', spec, 100 - i, 2000 - i),
    );
    const list = scoreTierList([], groups);

    expect(list.map((s) => s.spec)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(list.map((s) => s.tier).join('')).toBe('SAAABBBCCD');
    expect(
      scoreTierList([], [group('mage', 'b', 1, 1), group('mage', 'a', 1, 1)]).map((s) => s.spec),
    ).toEqual(['a', 'b']);
  });

  it('ranks the average by count as well: a few players do not beat many at a lower one', () => {
    const list = scoreTierList(
      [],
      [group('warrior', 'protection', 20, 1932), group('druid', 'feral', 660, 1865)],
    );
    const protection = list.find((s) => s.spec === 'protection')!;
    const feral = list.find((s) => s.spec === 'feral')!;

    expect(protection.averageRating).toEqual({ value: 1932, adjusted: 1623.4, score: 0 });
    expect(feral.averageRating).toEqual({ value: 1865, adjusted: 1839.3, score: 20 });
  });

  it('lists every spec given, one nobody plays last with nothing', () => {
    const list = scoreTierList(
      rows(3, 'mage', 'fire'),
      [group('mage', 'fire', 3, 1800)],
      [
        { class: 'warrior', spec: 'protection' },
        { class: 'mage', spec: 'fire' },
      ],
    );

    expect(list.map((s) => s.spec)).toEqual(['fire', 'protection']);
    expect(list[1]).toEqual({
      class: 'warrior',
      classId: 1,
      specId: 73,
      spec: 'protection',
      role: 'tank',
      // Of two specs the second is C: 90 % of 2 rounds to 2.
      tier: 'C',
      score: 0,
      baseScore: 0,
      modifier: 1,
      topDensity: { top250: 0, top500: 0, top1000: 0, top2500: 0, top5000: 0, score: 0 },
      representation: { count: 0, share: 0, score: 0 },
      averageRating: { value: null, adjusted: null, score: 0 },
    });
  });

  it('still scores a spec seen in the data but missing from the list', () => {
    const list = scoreTierList(
      [],
      [group('mage', 'fire', 3, 1800)],
      [{ class: 'warrior', spec: 'arms' }],
    );

    expect(list.map((s) => s.spec)).toEqual(['fire', 'arms']);
  });

  it('is empty when nothing has a spec, however many are listed', () => {
    expect(scoreTierList([ref(null, null)], [], [{ class: 'mage', spec: 'fire' }])).toEqual([]);
  });
});

describe('assignTiersAround', () => {
  it('leaves every tier as drawn when no spec is marked', () => {
    const scores = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    expect(
      assignTiersAround(
        scores,
        scores.map(() => false),
      ),
    ).toEqual(assignTiers(scores));
  });

  it('keeps the unmarked specs as drawn, and drops a marked one short of a tier to D', () => {
    // Ten specs, the last three marked. Drawn: S A A B B B C C C D.
    const scores = [100, 90, 85, 70, 65, 60, 40, 9, 8, 1];
    const placed = [false, false, false, false, false, false, false, true, true, true];
    const drawn = assignTiers(scores);
    expect(drawn.slice(7)).toEqual(['C', 'C', 'D']);

    const tiers = assignTiersAround(scores, placed);

    expect(tiers.slice(0, 7)).toEqual(drawn.slice(0, 7));
    // The one unmarked C scores 40: neither 9 nor 8 reaches it.
    expect(tiers.slice(7)).toEqual(['D', 'D', 'D']);
  });

  it('lets a marked spec keep a tier whose average it reaches, never raising it', () => {
    const scores = [100, 90, 85, 70, 65, 60, 40, 30, 20, 1];
    const placed = [false, false, false, true, false, false, false, false, false, false];

    // 70 reaches B's other specs (65, 60): it keeps its drawn B, never more.
    expect(assignTiersAround(scores, placed)[3]).toBe(assignTiers(scores)[3]);
  });
});

describe('role modifiers', () => {
  /** A ladder where a tank spec does well enough on its own to be ranked first. */
  const ladder = (bracket: string) =>
    scoreTierList(
      [...rows(5, 'druid', 'guardian'), ...rows(3, 'mage', 'fire'), ...rows(2, 'priest', 'holy')],
      [
        group('druid', 'guardian', 5, 1900),
        group('mage', 'fire', 3, 1850),
        group('priest', 'holy', 2, 1800),
      ],
      [],
      1500,
      PVP_ROLE_MODIFIERS[bracket],
    );
  const find = (list: ReturnType<typeof ladder>, spec: string) =>
    list.find((entry) => entry.spec === spec)!;

  it('halves an arena tank and orders the list by the result', () => {
    const list = ladder('3v3');
    const guardian = find(list, 'guardian');

    expect(guardian).toMatchObject({ role: 'tank', modifier: 0.5, baseScore: 100, score: 50 });
    expect(list.map((entry) => entry.spec)).toEqual(['fire', 'guardian', 'holy']);
  });

  it('boosts battleground tanks and healers, capped at 100, keeping the base', () => {
    const list = ladder('rbg');

    expect(find(list, 'guardian')).toMatchObject({ modifier: 1.3, baseScore: 100, score: 100 });
    expect(find(list, 'holy')).toMatchObject({ role: 'healer', modifier: 1.1 });
    expect(find(list, 'holy').score).toBeCloseTo(find(list, 'holy').baseScore * 1.1, 1);
    expect(find(list, 'fire')).toMatchObject({ role: 'dps', modifier: 1 });
  });

  it('leaves every spec at 1 without modifiers, as on Mythic+', () => {
    const list = scoreTierList(rows(1, 'druid', 'guardian'), [group('druid', 'guardian', 1, 1600)]);

    expect(list[0]).toMatchObject({ modifier: 1, score: list[0]!.baseScore });
  });

  it('puts the arena tanks of a full list in D, the others as they were', () => {
    const specs = [
      ...['blood', 'frost', 'unholy'].map((spec) => ({ class: 'deathknight', spec })),
      ...['guardian', 'balance', 'feral', 'restoration'].map((spec) => ({ class: 'druid', spec })),
      ...['protection', 'arms', 'fury'].map((spec) => ({ class: 'warrior', spec })),
    ];
    // A spec's rows: dps and healers many, the tanks few — but more than the weakest dps.
    const sizes: Record<string, number> = {
      'deathknight-blood': 3,
      'druid-guardian': 4,
      'warrior-protection': 2,
      'deathknight-frost': 1,
    };
    const size = (s: { class: string; spec: string }) =>
      sizes[`${s.class}-${s.spec}`] ?? 20 + specs.indexOf(s);
    const top = specs.flatMap((s) => rows(size(s), s.class, s.spec));
    const groups = specs.map((s) => group(s.class, s.spec, size(s), 1700));

    const plain = scoreTierList(top, groups, specs);
    const modified = scoreTierList(top, groups, specs, 1500, PVP_ROLE_MODIFIERS['3v3']);
    const tierOf = (list: typeof plain, spec: string) => find(list, spec).tier;

    expect(['blood', 'guardian', 'protection'].map((spec) => tierOf(modified, spec))).toEqual([
      'D',
      'D',
      'D',
    ]);
    for (const spec of ['frost', 'unholy', 'balance', 'feral', 'restoration', 'arms', 'fury']) {
      expect(tierOf(modified, spec)).toBe(tierOf(plain, spec));
    }
  });
});
