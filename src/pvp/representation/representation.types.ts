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

/** One stored day of a history. */
export interface RepresentationDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  computedAt: string;
  total: number;
  /** 0 on a 2v2, 3v3 or RBG day before Rankwarden enriched the ladder; `specs` is then empty. */
  classified: number;
  /**
   * Most played first, each exactly as the day's own endpoint gives it:
   * `share` of `classified` (0–1), and the spec's hero talent split, each
   * `share` of its `heroTalentsClassified`.
   */
  specs: SpecShare[];
}

/**
 * The last `HISTORY_DAYS` UTC days of one region, bracket and rating, for a
 * graph of each spec over time. Only days with a snapshot are listed, oldest
 * first: a day Rankwarden did not write — today before its daily run, or one
 * the job missed, or one before the season started — is simply absent, and
 * `days[0].date` is where the data begins.
 */
export interface RepresentationHistoryResponse {
  region: Region;
  bracket: string;
  rating: number;
  /** The window asked about, `YYYY-MM-DD`, inclusive: the axis to draw. */
  from: string;
  to: string;
  days: RepresentationDay[];
}
