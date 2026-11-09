import { describe, expect, it } from 'vitest';

import { topCompositions, type RosterSlot } from './compositions.js';

const SLOTS = {
  blood: { classId: 6, className: 'Death Knight', specId: 250, specName: 'Blood', role: 'tank' },
  brew: { classId: 10, className: 'Monk', specId: 268, specName: 'Brewmaster', role: 'tank' },
  disc: { classId: 5, className: 'Priest', specId: 256, specName: 'Discipline', role: 'healer' },
  rsham: { classId: 7, className: 'Shaman', specId: 264, specName: 'Restoration', role: 'healer' },
  arcane: { classId: 8, className: 'Mage', specId: 62, specName: 'Arcane', role: 'dps' },
  aug: { classId: 13, className: 'Evoker', specId: 1473, specName: 'Augmentation', role: 'dps' },
  bm: { classId: 3, className: 'Hunter', specId: 253, specName: 'Beast Mastery', role: 'dps' },
} satisfies Record<string, RosterSlot>;

type Slot = keyof typeof SLOTS;
const roster = (...slots: Slot[]): RosterSlot[] => slots.map((slot) => SLOTS[slot]);

describe('topCompositions', () => {
  it('counts the same class and spec pairs as one, whatever the roster order', () => {
    const list = topCompositions([
      roster('arcane', 'blood', 'aug', 'disc', 'bm'),
      roster('disc', 'bm', 'arcane', 'aug', 'blood'),
      roster('brew', 'rsham', 'arcane', 'aug', 'bm'),
    ]);

    expect(list.map((c) => [c.rank, c.count, c.share])).toEqual([
      [1, 2, 0.6667],
      [2, 1, 0.3333],
    ]);
  });

  it('lists members tank, healer, then damage dealers by class id, with slugs', () => {
    const [first] = topCompositions([roster('arcane', 'aug', 'disc', 'bm', 'blood')]);

    expect(first!.members.map((m) => `${m.class}-${m.spec}`)).toEqual([
      'deathknight-blood',
      'priest-discipline',
      'hunter-beastmastery',
      'mage-arcane',
      'evoker-augmentation',
    ]);
    expect(first!.members[0]).toEqual({
      class: 'deathknight',
      spec: 'blood',
      classId: 6,
      className: 'Death Knight',
      specId: 250,
      specName: 'Blood',
      role: 'tank',
    });
  });

  it('tells two specs of one class apart', () => {
    const fire = { ...SLOTS.arcane, specId: 63, specName: 'Fire' };
    const list = topCompositions([
      roster('blood', 'disc', 'arcane', 'aug', 'bm'),
      [SLOTS.blood, SLOTS.disc, fire, SLOTS.aug, SLOTS.bm],
    ]);

    expect(list).toHaveLength(2);
  });

  it('keeps equal counts in the order of their best run', () => {
    const list = topCompositions([
      roster('brew', 'rsham', 'arcane', 'aug', 'bm'),
      roster('blood', 'disc', 'arcane', 'aug', 'bm'),
    ]);

    expect(list.map((c) => c.members[0]!.spec)).toEqual(['brewmaster', 'blood']);
  });

  it('keeps a member without a spec, with null slugs', () => {
    const unknown = { ...SLOTS.bm, specId: null, specName: null };
    const [first] = topCompositions([[SLOTS.blood, SLOTS.disc, SLOTS.arcane, SLOTS.aug, unknown]]);

    expect(first!.members.find((m) => m.specId === null)).toMatchObject({
      class: 'hunter',
      spec: null,
    });
  });

  it('answers at most the limit, and nothing for no runs', () => {
    const rosters = (['arcane', 'aug', 'bm'] as const).map((dps) =>
      roster('blood', 'disc', dps, dps, dps),
    );

    expect(topCompositions(rosters, 2)).toHaveLength(2);
    expect(topCompositions([])).toEqual([]);
  });
});
