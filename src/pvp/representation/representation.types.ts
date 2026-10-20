import type { Region } from '../../blizzard/blizzard.constants.js';
import type { SpecShare } from '../entities/spec-representation.entity.js';

export interface RepresentationResponse {
  region: Region;
  bracket: string;
  rating: number;
  /**
   * The day answered, `YYYY-MM-DD`: the day asked for, or with `date=latest`
   * the day of the newest snapshot stored.
   */
  date: string;
  /** When Rankwarden computed the snapshot. */
  computedAt: string;
  /** Rows at or above the rating. */
  total: number;
  /** Of those, how many have a known spec: 0 on a ladder not enriched yet. */
  classified: number;
  /** Most played first. */
  specs: SpecShare[];
  /**
   * Only when `getEarliestDate=true`: the first day, `YYYY-MM-DD`, whose
   * snapshot has classified specs for this region, bracket and rating. Null
   * when no day has any yet.
   */
  earliestDate?: string | null;
}
