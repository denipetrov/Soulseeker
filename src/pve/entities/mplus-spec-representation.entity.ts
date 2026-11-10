import type { DungeonRef } from '../../characters/entities/mplus-character.entity.js';

/** One spec's share of a season's runs, as Rankwarden stores it. */
export interface MplusSpecShareDocument {
  classId: number;
  className: string;
  specId: number;
  specName: string;
  role: string;
  /** Roster slots this spec filled across the runs counted. */
  count: number;
  /** Share of every classified slot, 0–100. */
  percent: number;
  /** Share of the slots of its own role, 0–100: the figure to compare specs by. */
  rolePercent: number;
}

/**
 * A document in Rankwarden's `mplus_spec_representation`: which specs a
 * season's stored runs were played with, counted by roster slot, for one
 * region (or `all` together) and one dungeon (or every dungeon, `dungeonId`
 * null). Read-only; the shape is Rankwarden's
 * (`src/mplus-representation/entities/mplus-spec-representation.entity.ts`).
 *
 * Not dated: one document per season, region and dungeon, recomputed after
 * every live pass while the season is current (`source: 'live'`), and written
 * once from the archive when it ends (`source: 'archive'`). Keyed by
 * `mplus_representation_key` (season, region, dungeonId).
 */
export interface MplusSpecRepresentationDocument {
  season: string;
  seasonId: number | null;
  region: string;
  dungeonId: number | null;
  dungeon: DungeonRef | null;
  source: 'live' | 'archive';
  runs: number;
  slots: number;
  classified: number;
  roles: Record<string, number>;
  /** Highest count first. */
  specs: MplusSpecShareDocument[];
  computedAt: Date;
}
