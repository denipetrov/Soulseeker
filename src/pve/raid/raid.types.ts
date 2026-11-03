import type { BossDifficulty } from '../../characters/entities/boss.entity.js';
import type { RaidEncounter } from '../../seasons/pve-catalogue.service.js';
import type { GuildRef } from '../shared/guild-refs.service.js';

export interface RaidPull {
  /** The id of the boss in `raid.encounters`; null if the catalogue does not list it. */
  encounterId: number | null;
  slug: string;
  /** Pulls up to and including the kill; null when the guild hides its pulls. */
  numPulls: number | null;
  /** ISO 8601: when the guild first pulled the boss. */
  pullStartedAt: string | null;
  /** Boss health left on the best attempt; 0 once defeated. */
  bestPercent: number | null;
  isDefeated: boolean;
}

export interface RaidKill {
  encounterId: number | null;
  slug: string;
  /** ISO 8601. */
  firstDefeated: string | null;
  lastDefeated: string | null;
}

/** One guild on the raid's board, as Rankwarden stores it, with the guild itself. */
export interface RaidRanking {
  rank: number;
  /** Place within the guild's own region; differs from `rank` on `world`. */
  regionRank: number | null;
  guild: GuildRef;
  /** Empty on raids before Shadowlands, and for a guild that hides its pulls. */
  encountersPulled: RaidPull[];
  encountersDefeated: RaidKill[];
}

export interface RaidResponse {
  /** `world` or the region asked for. */
  region: string;
  difficulty: BossDifficulty;
  raid: {
    slug: string;
    name: string;
    /** As `GET /pve/raids` gives it: an icon name or a numeric file id; null before BfA. */
    icon: string | null;
    /** In boss order. */
    encounters: RaidEncounter[];
  };
  /** When Rankwarden last read this board; null if it never has. */
  updatedAt: string | null;
  /** Best first: the top hundred. Empty for a board never read. */
  guilds: RaidRanking[];
}
