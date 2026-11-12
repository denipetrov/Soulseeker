import { describe, expect, it } from 'vitest';

import { combineSnapshots, type CombinedSnapshot } from './combine.js';

const tree = (id: number, name: string, count: number, share = 0) => ({ id, name, count, share });

const snapshot = (
  total: number,
  specs: CombinedSnapshot['specs'],
  computedAt = '2026-11-10T08:00:00Z',
): CombinedSnapshot => ({
  total,
  classified: specs.reduce((sum, spec) => sum + spec.count, 0),
  specs,
  computedAt: new Date(computedAt),
});

const disc = (count: number, voidweaver: number, oracle: number) => ({
  class: 'priest',
  spec: 'discipline',
  count,
  share: 0.5,
  heroTalentsClassified: voidweaver + oracle,
  heroTalents: [tree(18, 'Voidweaver', voidweaver), tree(19, 'Oracle', oracle)],
});
const fire = (count: number) => ({
  class: 'mage',
  spec: 'fire',
  count,
  share: 0.5,
  heroTalentsClassified: 0,
  heroTalents: [],
});

describe('combineSnapshots', () => {
  it('adds the counts and works the shares out again from the sums', () => {
    const combined = combineSnapshots([
      snapshot(110, [disc(90, 60, 30), fire(10)]),
      snapshot(20, [disc(5, 1, 4), fire(15)], '2026-11-10T09:30:00Z'),
    ]);

    expect(combined.total).toBe(130);
    expect(combined.classified).toBe(120);
    expect(combined.computedAt).toEqual(new Date('2026-11-10T09:30:00Z'));
    // 95 of 120, not the mean of 0.9 and 0.25.
    expect(combined.specs.map((s) => [s.spec, s.count, s.share])).toEqual([
      ['discipline', 95, 0.7917],
      ['fire', 25, 0.2083],
    ]);
  });

  it('adds hero talent trees the same way, most played first', () => {
    const [discipline] = combineSnapshots([
      snapshot(90, [disc(90, 60, 30)]),
      snapshot(50, [disc(50, 10, 40)]),
    ]).specs;

    expect(discipline).toMatchObject({ heroTalentsClassified: 140 });
    expect(discipline!.heroTalents).toEqual([
      tree(18, 'Voidweaver', 70, 0.5),
      tree(19, 'Oracle', 70, 0.5),
    ]);
  });

  it('keeps a spec only one region plays', () => {
    const combined = combineSnapshots([snapshot(10, [fire(10)]), snapshot(5, [disc(5, 5, 0)])]);

    expect(combined.specs.map((s) => s.spec)).toEqual(['fire', 'discipline']);
  });

  it('answers one snapshot as it is', () => {
    const one = snapshot(10, [fire(10)]);

    expect(combineSnapshots([one])).toBe(one);
  });
});
