import { SPECIALIZATIONS } from '@denipetrov/spirit-link/constants';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkRoleFilters, rolesOf, SPEC_ROLES, specsMatching } from './roles.js';
import { ALL_SPECS } from './specs.js';

const slugs = (pairs: { class: string; spec: string }[]) =>
  pairs.map((pair) => `${pair.class}-${pair.spec}`);

describe('spec roles', () => {
  it('gives every spec of ours a role, and every spirit-link spec a slug', () => {
    expect(ALL_SPECS.every((pair) => rolesOf(pair.class, pair.spec) !== null)).toBe(true);
    expect(SPEC_ROLES.size).toBe(SPECIALIZATIONS.length);
  });

  it('tells the two Frost specs apart', () => {
    expect(rolesOf('deathknight', 'frost')).toEqual({ role: 'dps', subRole: 'melee' });
    expect(rolesOf('mage', 'frost')).toEqual({ role: 'dps', subRole: 'ranged' });
  });

  it('gives tanks and healers no sub-role', () => {
    expect(rolesOf('paladin', 'protection')).toEqual({ role: 'tank', subRole: null });
    expect(rolesOf('evoker', 'preservation')).toEqual({ role: 'healer', subRole: null });
  });

  it('matches by class, role and sub-role', () => {
    expect(slugs(specsMatching({ role: 'tank' }))).toEqual([
      'deathknight-blood',
      'demonhunter-vengeance',
      'druid-guardian',
      'monk-brewmaster',
      'paladin-protection',
      'warrior-protection',
    ]);
    expect(slugs(specsMatching({ class: 'druid', role: 'dps' }))).toEqual([
      'druid-balance',
      'druid-feral',
    ]);
    expect(slugs(specsMatching({ class: 'hunter', subRole: 'melee' }))).toEqual([
      'hunter-survival',
    ]);
    expect(specsMatching({ subRole: 'melee' })).toHaveLength(13);
    expect(specsMatching({ subRole: 'ranged' })).toHaveLength(14);
    expect(specsMatching({})).toHaveLength(ALL_SPECS.length);
  });
});

describe('checkRoleFilters', () => {
  const issues = (query: Parameters<typeof checkRoleFilters>[0]) => {
    const result = z
      .object({})
      .passthrough()
      .superRefine((_, ctx) => {
        checkRoleFilters(query, ctx);
      })
      .safeParse({});
    return result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('accepts role, sub-role and class together when they fit', () => {
    expect(issues({ role: 'dps', subRole: 'ranged' })).toEqual([]);
    expect(issues({ class: 'druid', role: 'healer' })).toEqual([]);
    expect(issues({ subRole: 'melee' })).toEqual([]);
  });

  it('refuses a sub-role for tanks or healers, a role with a spec, a class without the role', () => {
    expect(issues({ role: 'tank', subRole: 'melee' })).toEqual(['subRole: is only for role dps']);
    expect(issues({ class: 'mage', spec: 'fire', role: 'dps' })).toEqual([
      'role: cannot be combined with spec',
    ]);
    expect(issues({ class: 'mage', spec: 'fire', subRole: 'ranged' })).toEqual([
      'subRole: cannot be combined with spec',
    ]);
    expect(issues({ class: 'priest', role: 'tank' })).toEqual(['class: has no tank spec']);
    expect(issues({ class: 'mage', subRole: 'melee' })).toEqual(['class: has no melee spec']);
  });
});
