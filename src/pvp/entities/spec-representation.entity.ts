import type { Region } from '../../blizzard/blizzard.constants.js';

/** How a spec's players split between its hero talent trees. */
export interface HeroTalentShare {
  id: number;
  name: string;
  count: number;
  /** Of the spec's `heroTalentsClassified`, 0–1. */
  share: number;
}

/** One spec's place in a snapshot. */
export interface SpecShare {
  /** Slugs, as on the ladders: `warrior`, `arms`. */
  class: string;
  spec: string;
  count: number;
  /** Of the snapshot's `classified`, 0–1. */
  share: number;
  /** Of `count`, how many have a known hero talent tree. */
  heroTalentsClassified: number;
  heroTalents: HeroTalentShare[];
}

/**
 * A document in Rankwarden's `spec_representation`: which specs are played at
 * or above one rating, on one ladder family, in one region, on one UTC day.
 * Rankwarden writes one per day per tracked cutoff (`REPRESENTATION_MIN_RATINGS`
 * in spirit-link) and removes snapshots from before the current season.
 */
export interface SpecRepresentationDocument {
  /** UTC midnight of the day described. */
  date: Date;
  seasonId: number;
  region: Region;
  family: '2v2' | '3v3' | 'rbg' | 'shuffle' | 'blitz';
  minRating: number;
  /** Rows at or above the cutoff. */
  total: number;
  /**
   * Of those, how many had a known spec. On 2v2, 3v3 and RBG it follows
   * Rankwarden's enrichment, so it can be 0 with `specs` empty.
   */
  classified: number;
  specs: SpecShare[];
  computedAt: Date;
}
