import type { BossDifficulty } from './boss.entity.js';

/** One boss a ranked guild has pulled. */
export interface RaidEncounterPull {
  /** The id of the boss in the raid's `encounters`; null if the catalogue does not list it. */
  encounterId: number | null;
  slug: string;
  /** Pulls up to and including the kill; null when the guild hides its pulls. */
  numPulls: number | null;
  pullStartedAt: Date | null;
  /** Boss health left on the best attempt; 0 once defeated. */
  bestPercent: number | null;
  isDefeated: boolean;
}

/** One boss a ranked guild has killed. */
export interface RaidEncounterKill {
  encounterId: number | null;
  slug: string;
  firstDefeated: Date | null;
  lastDefeated: Date | null;
}

/** One guild's place on one raid board, at one difficulty. */
export interface RaidRankedGuild {
  rank: number;
  /** Place within the guild's own region; differs from `rank` on `world`. */
  regionRank: number | null;
  /** The guild's `id` in `guilds`. */
  guildId: number;
  /** Empty on raids before Shadowlands and for a guild that hides its pulls. */
  encountersPulled: RaidEncounterPull[];
  encountersDefeated: RaidEncounterKill[];
}

/**
 * The ranking boards of a document in Rankwarden's `raids` — the rest of the
 * document is the catalogue (`PveCatalogue`). Read-only; the shape is
 * Rankwarden's (`src/raid/entities/raid.entity.ts`).
 */
export interface RaidBoardsDocument {
  slug: string;
  /** The top hundred guilds, per board and difficulty: `guilds.world.mythic`. */
  guilds?: Partial<Record<string, Partial<Record<BossDifficulty, RaidRankedGuild[]>>>>;
  /** When each board was last read, in the same shape. */
  guildsUpdatedAt?: Partial<Record<string, Partial<Record<BossDifficulty, Date>>>>;
}
