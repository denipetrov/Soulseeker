/** The raid difficulties a boss board is kept for, hardest first. */
export const BOSS_DIFFICULTIES = ['mythic', 'heroic', 'normal'] as const;
export type BossDifficulty = (typeof BOSS_DIFFICULTIES)[number];

/**
 * One guild's place on one boss's board, at one difficulty, on `world` or one
 * region. `attempts` and `firstDefeated` are its first kill; both null for a
 * guild ranked for progress on a boss it has not killed yet.
 */
export interface BossRankedGuild {
  /** The guild's `id` in `guilds`. */
  guildId: number;
  rank: number;
  itemLevelAvg: number | null;
  /** Pulls before the first kill; Raider.io sends none for many guilds and every old raid. */
  attempts: number | null;
  firstDefeated: Date | null;
}

/**
 * A document in Rankwarden's `bosses`: one boss of one raid, keyed by the
 * encounter id of the raid's `encounters`, with the first fifty guilds to kill
 * it per board and difficulty. Read-only here; the shape is Rankwarden's
 * (`src/raid/entities/boss.entity.ts`).
 *
 * `slug` is unique only within a raid — a re-release's boss can share the
 * original's — so a boss is read by `raidSlug` and `slug` together, through
 * `boss_raid_slug_name`.
 */
export interface BossDocument {
  /** The encounter id, as the raid's `encounters` list it. */
  id: number;
  raidId: number;
  raidSlug: string;
  name: string;
  slug: string;
  catalogueUpdatedAt: Date;
  /** `bossRankings.world.mythic`, `bossRankings.eu.heroic`; absent until a board is read. */
  bossRankings?: Partial<Record<string, Partial<Record<BossDifficulty, BossRankedGuild[]>>>>;
}
