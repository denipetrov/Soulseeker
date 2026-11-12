import { describe, expect, it } from 'vitest';

import { specStats, treeOf, type TreeProfile } from './hero-talents.stats.js';

const SLAYER = { id: 60, name: 'Slayer' };
const COLOSSUS = { id: 62, name: 'Colossus' };
const MOUNTAIN = { id: 63, name: 'Mountain Thane' };

const profile = (
  active: typeof SLAYER | null,
  loadouts: [string, typeof SLAYER | null][],
): TreeProfile => ({
  heroTalentTree: active,
  talentLoadouts: loadouts.map(([spec, tree]) => ({
    spec: { id: 1, name: spec },
    talentLoadoutCode: null,
    heroTalentTree: tree,
  })),
});

describe('treeOf', () => {
  const warrior = profile(MOUNTAIN, [
    ['Arms', SLAYER],
    ['Fury', MOUNTAIN],
  ]);

  it('reads the ladder spec’s own loadout on a per-spec ladder', () => {
    expect(treeOf(warrior, 'arms', true)).toEqual(SLAYER);
    expect(treeOf(warrior, 'fury', true)).toEqual(MOUNTAIN);
  });

  it('reads the active spec’s tree elsewhere', () => {
    expect(treeOf(warrior, 'arms', false)).toEqual(MOUNTAIN);
  });

  it('is null with no profile, no loadout for the spec, or no tree', () => {
    expect(treeOf(undefined, 'arms', true)).toBeNull();
    expect(treeOf(warrior, 'protection', true)).toBeNull();
    expect(treeOf(profile(null, []), 'arms', false)).toBeNull();
  });

  it('matches a spec name with spaces to its slug', () => {
    const hunter = profile(null, [['Beast Mastery', { id: 41, name: 'Pack Leader' }]]);

    expect(treeOf(hunter, 'beastmastery', true)).toEqual({ id: 41, name: 'Pack Leader' });
  });
});

describe('specStats', () => {
  it('counts the trees of the covered characters, shares of those covered', () => {
    const stats = specStats('arms', [
      { rating: 3100, tree: SLAYER },
      { rating: 2900, tree: COLOSSUS },
      { rating: 3050, tree: SLAYER },
      { rating: 2800, tree: null },
    ]);

    expect(stats).toEqual({
      spec: 'arms',
      characters: 4,
      covered: 3,
      minRating: 2800,
      maxRating: 3100,
      heroTalents: [
        { id: 60, name: 'Slayer', count: 2, share: 0.6667 },
        { id: 62, name: 'Colossus', count: 1, share: 0.3333 },
      ],
    });
  });

  it('orders equal counts by tree id', () => {
    const stats = specStats('arms', [
      { rating: 1, tree: COLOSSUS },
      { rating: 1, tree: SLAYER },
    ]);

    expect(stats.heroTalents.map((use) => use.id)).toEqual([60, 62]);
  });

  it('answers a spec with nobody', () => {
    expect(specStats('arms', [])).toEqual({
      spec: 'arms',
      characters: 0,
      covered: 0,
      minRating: null,
      maxRating: null,
      heroTalents: [],
    });
  });
});
