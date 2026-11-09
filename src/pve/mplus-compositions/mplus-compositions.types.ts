/** One member of a composition: a class and spec, as the runs store them. */
export interface CompositionMember {
  /** Class and spec slugs, as the other endpoints take them; null for an id not known here. */
  class: string | null;
  spec: string | null;
  classId: number;
  className: string;
  /** Null for a member Raider.io reported without a spec. */
  specId: number | null;
  specName: string | null;
  role: string;
}

export interface Composition {
  /** 1 for the most played. */
  rank: number;
  /** Runs among those read that this party finished. */
  count: number;
  /** `count` over the runs read, 0–1. */
  share: number;
  /** Tank, healer, then damage dealers; within a role, by class and spec id. */
  members: CompositionMember[];
}

export interface MplusCompositionsResponse {
  /** `world` or the region asked for. */
  region: string;
  /** The season slug answered: `current` resolved. */
  season: string;
  /** Read from the live collection; false for an archived season. */
  current: boolean;
  /** The dungeon slug asked for, or null for every dungeon. */
  dungeon: string | null;
  /** The best runs asked to be read. */
  top: number;
  /** Runs read: `top`, or fewer on a board that holds fewer. */
  runs: number;
  /** The 50 most played compositions among them, most played first. */
  compositions: Composition[];
}
