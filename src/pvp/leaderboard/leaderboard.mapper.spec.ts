import { describe, expect, it } from 'vitest';

import type { Cutoff } from '../seasons/pvp-season.types.js';
import { heroTalentsFor, inTitleRange, slugOf, type BoardCharacter } from './leaderboard.mapper.js';

const shared: Cutoff = { rating: 2858, title: 'Gladiator', achievementId: 1, factions: null };
const split: Cutoff = {
  rating: null,
  title: 'Notorious Gladiator',
  achievementId: 1,
  factions: {
    alliance: { rating: 3071, title: 'Notorious Gladiator', achievementId: 1 },
    horde: { rating: 2953, title: 'Notorious Gladiator', achievementId: 1 },
  },
};

describe('inTitleRange', () => {
  it('compares against a shared cutoff, inclusive', () => {
    expect(inTitleRange(2858, shared, 'horde')).toBe(true);
    expect(inTitleRange(2857, shared, null)).toBe(false);
  });

  it("uses the character's own faction where the cutoffs differ", () => {
    expect(inTitleRange(3000, split, 'horde')).toBe(true);
    expect(inTitleRange(3000, split, 'alliance')).toBe(false);
    expect(inTitleRange(3000, split, 'ALLIANCE')).toBe(false);
    expect(inTitleRange(9999, split, null)).toBe(false);
  });

  it('is never in range without a cutoff', () => {
    expect(inTitleRange(4000, null, 'horde')).toBe(false);
  });
});

describe('heroTalentsFor', () => {
  const warrior = {
    profile: {
      heroTalentTree: { id: 1, name: 'Mountain Thane' },
      talentLoadouts: [
        {
          spec: { id: 71, name: 'Arms' },
          talentLoadoutCode: null,
          heroTalentTree: { id: 2, name: 'Slayer' },
        },
        {
          spec: { id: 72, name: 'Fury' },
          talentLoadoutCode: null,
          heroTalentTree: { id: 1, name: 'Mountain Thane' },
        },
      ],
    },
  } as unknown as BoardCharacter;

  it("takes the ladder's spec loadout on a spec ladder, not the active spec", () => {
    expect(heroTalentsFor(warrior, 'arms', true)).toBe('Slayer');
    expect(heroTalentsFor(warrior, 'protection', true)).toBeNull();
  });

  it('takes the active tree on 2v2, 3v3 and RBG', () => {
    expect(heroTalentsFor(warrior, null, false)).toBe('Mountain Thane');
  });

  it('is null for a character not enriched yet', () => {
    expect(heroTalentsFor(undefined, 'arms', true)).toBeNull();
  });
});

describe('slugOf', () => {
  it('matches the slugs ladder names use', () => {
    expect(slugOf('Beast Mastery')).toBe('beastmastery');
    expect(slugOf('Death Knight')).toBe('deathknight');
    expect(slugOf(null)).toBeNull();
  });
});
