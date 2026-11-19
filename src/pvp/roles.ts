import { SPECIALIZATIONS, SpecRole, SpecSubRole } from '@denipetrov/spirit-link/constants';
import { z } from 'zod';

import { ALL_SPECS, SPEC_IDS, type CLASSES } from './specs.js';

/** `tank`, `healer`, `dps`: spirit-link's `SpecRole`, as Raider.io and Rankwarden spell roles. */
export const ROLES = Object.values(SpecRole);
/** `melee`, `ranged`: spirit-link's `SpecSubRole`, which splits dps only. */
export const SUB_ROLES = Object.values(SpecSubRole);

export type Role = SpecRole;
export type SubRole = SpecSubRole;

export interface SpecPair {
  class: string;
  spec: string;
}

export interface SpecRoles {
  role: Role;
  /** Null for tanks and healers. */
  subRole: SubRole | null;
}

const SPEC_SLUG_BY_ID = new Map(Object.entries(SPEC_IDS).map(([slug, id]) => [id, slug]));

/**
 * Each spec's role and sub-role, by `class-spec` slug, from spirit-link's
 * `SPECIALIZATIONS` matched on Blizzard's spec id. spirit-link is the one list
 * shared with Rankwarden; the slugs are this service's.
 */
export const SPEC_ROLES: ReadonlyMap<string, SpecRoles> = new Map(
  SPECIALIZATIONS.flatMap((spec) => {
    const slug = SPEC_SLUG_BY_ID.get(spec.id);
    return slug ? [[slug, { role: spec.role, subRole: spec.subRole }] as const] : [];
  }),
);

/** A spec's role and sub-role, or null for a pair spirit-link does not list. */
export function rolesOf(cls: string, spec: string): SpecRoles | null {
  return SPEC_ROLES.get(`${cls}-${spec}`) ?? null;
}

/**
 * The class and spec pairs a filter names: every spec of `class` (or of every
 * class) that plays `role`, and `subRole` when given. A sub-role implies dps.
 */
export function specsMatching(filter: {
  class?: string | null;
  role?: Role | null;
  subRole?: SubRole | null;
}): SpecPair[] {
  return ALL_SPECS.filter((pair) => {
    if (filter.class && pair.class !== filter.class) return false;
    const roles = rolesOf(pair.class, pair.spec);
    if (!roles) return false;
    if (filter.role && roles.role !== filter.role) return false;
    if (filter.subRole && roles.subRole !== filter.subRole) return false;
    return true;
  });
}

export const roleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(ROLES))
  .optional()
  .meta({
    description: 'Only specs of this group role. With or without class; not with spec.',
    enum: [...ROLES],
  });

export const subRoleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(SUB_ROLES))
  .optional()
  .meta({
    description:
      'Only damage dealers fighting in melee or from range. Implies role `dps`; with or ' +
      'without class; not with spec.',
    enum: [...SUB_ROLES],
  });

/**
 * The rules every role filter shares, as validation issues: a sub-role is a
 * kind of dps, a spec already has a role, and a class must have a spec that
 * fits (a priest has no tank spec). False when it added an issue.
 */
export function checkRoleFilters(
  query: {
    class?: (typeof CLASSES)[number] | null;
    spec?: string | null;
    role?: Role | null;
    subRole?: SubRole | null;
  },
  ctx: z.RefinementCtx,
): boolean {
  const { role, subRole } = query;

  if (subRole && role && role !== SpecRole.Dps) {
    ctx.addIssue({ code: 'custom', path: ['subRole'], message: 'is only for role dps' });
    return false;
  }
  if (query.spec && (role || subRole)) {
    ctx.addIssue({
      code: 'custom',
      path: [role ? 'role' : 'subRole'],
      message: 'cannot be combined with spec',
    });
    return false;
  }
  if (query.class && (role || subRole) && specsMatching(query).length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['class'],
      message: `has no ${subRole ?? role} spec`,
    });
    return false;
  }

  return true;
}
