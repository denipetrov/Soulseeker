import type { MplusSpecShareDocument } from '../entities/mplus-spec-representation.entity.js';

/** One spec's share, as stored, with the slugs the other endpoints take. */
export interface PveSpecShare extends MplusSpecShareDocument {
  /** Class and spec slugs; null for an id not known here. */
  class: string | null;
  spec: string | null;
}

export interface PveRepresentationResponse {
  /** `world` or the region asked for. */
  region: string;
  /** The season slug answered: `current` resolved. */
  season: string;
  /** The dungeon slug asked for, or `all`. */
  dungeon: string;
  /** `live`: recomputed after every Rankwarden pass. `archive`: final, written once. */
  source: 'live' | 'archive';
  /** When Rankwarden last computed it. */
  computedAt: string;
  /** Runs counted: the top of each region's board, to the depth Rankwarden reads. */
  runs: number;
  /** Roster slots counted (five a run, anonymised players included). */
  slots: number;
  /** Of those, the slots with a known spec; `percent` is a share of these. */
  classified: number;
  /** Classified slots per role; `rolePercent` is a share of these. */
  roles: Record<string, number>;
  /** Most played first. */
  specs: PveSpecShare[];
  /**
   * Only with `getSeasons=true`: the seasons that have a snapshot for this
   * region and dungeon, newest first.
   */
  seasons?: string[];
}
