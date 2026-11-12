import type { PvpBoard } from '../world.js';

/** One hero talent tree's use among a spec's top characters. */
export interface HeroTalentUse {
  id: number;
  name: string;
  /** Characters playing it. */
  count: number;
  /** Of the spec's `covered`, 0–1. */
  share: number;
}

/** One spec's top characters and the hero talent trees they play. */
export interface SpecHeroTalents {
  spec: string;
  /** Characters read: the spec's top `top`, or fewer on a shorter ladder. */
  characters: number;
  /**
   * Of those, the ones whose tree is known: Rankwarden enriches characters
   * over time, so the rest have none yet. The shares are of these.
   */
  covered: number;
  /** The lowest and highest rating among `characters`; null with none. */
  minRating: number | null;
  maxRating: number | null;
  /** Most played first. */
  heroTalents: HeroTalentUse[];
}

export interface ClassHeroTalents {
  class: string;
  specs: SpecHeroTalents[];
}

export interface HeroTalentsResponse {
  /** A region, or `world`: every region's ladder together. */
  region: PvpBoard;
  bracket: string;
  seasonId: number;
  seasonName: string | null;
  /** Characters asked for per spec. */
  top: number;
  /** When it was computed; it is reused for `HERO_TALENTS_CACHE_TTL_SECONDS`. */
  computedAt: string;
  /** Every class, each with every spec, in the game's order. */
  classes: ClassHeroTalents[];
}
