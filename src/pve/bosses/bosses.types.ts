import type { BossDifficulty } from '../../characters/entities/boss.entity.js';
import type { GuildRef } from '../shared/guild-refs.service.js';

/** The raid a boss belongs to. */
export interface BossRaid {
  slug: string;
  name: string;
  /** As `GET /pve/raids` gives it: an icon name or a numeric file id; null before BfA. */
  icon: string | null;
  expansionId: number;
}

export interface BossRanking {
  rank: number;
  itemLevelAvg: number | null;
  /** Pulls before the first kill; often null, as Raider.io does not always send it. */
  attempts: number | null;
  /** ISO 8601; null for a guild ranked for progress without a kill yet. */
  firstDefeated: string | null;
  guild: GuildRef;
}

export interface BossEntry {
  bossName: string;
  bossSlug: string;
  raid: BossRaid;
  /** Best first, at most `top`, at the answer's `difficulty`. */
  bossRankings: BossRanking[];
}

export interface BossesResponse {
  /** `world` or the region asked for. */
  region: string;
  /**
   * The one difficulty every boss is answered at: the one asked for, or the
   * hardest on which any of them has guilds. Null when no board has any:
   * every `bossRankings` is then empty.
   */
  difficulty: BossDifficulty | null;
  /** In the raid's boss order; one entry with `bossSlug`. */
  bosses: BossEntry[];
}
