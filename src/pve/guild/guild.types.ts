import type { RaidDifficulty } from '@denipetrov/spirit-link/constants';

import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';

/** Raider.io's guild profile, sent with every answer that asks for it. */
export interface GuildBase {
  name: string;
  displayName: string | null;
  faction: string | null;
  /** The realm's display name ("Tarren Mill"); the slug is the request's `realmSlug`. */
  realm: string;
  region: string;
  profileUrl: string | null;
  /** When Raider.io last read the guild. */
  lastCrawledAt: string | null;
}

/** A member: the guild rank (0 = guild master) and the character's base profile, as Raider.io shapes it. */
export interface GuildMember {
  rank: number;
  character: Record<string, unknown>;
}

/** The guild's summary: what the guild page shows first. */
export interface SummaryPart {
  fetchedAt: string;
  guild: GuildBase;
  /** Per raid slug of the current expansion: `summary` ("9/9 M") and bosses killed per difficulty. */
  raidProgression: Record<string, Record<string, unknown>>;
  /** Per raid slug, per difficulty: `{ world, region, realm }`. */
  raidRankings: Record<string, Record<string, unknown>>;
  /** The guild master (rank 0) and the rank just below it (1), in that order. */
  members: GuildMember[];
}

/** One raid's bosses on one difficulty. */
export interface RaidEncountersPart {
  fetchedAt: string;
  guild: GuildBase;
  /** Each boss the guild killed, in kill order, with when. Empty when none. */
  encounters: { slug: string; name: string; defeatedAt: string | null }[];
}

/** The guild's kill of one boss on one difficulty, as Raider.io returns it. */
export interface BossKillPart {
  fetchedAt: string;
  /** Times, duration, and the group's item level. Null when the guild has not killed it. */
  kill: Record<string, unknown> | null;
  /** Every player, with talents, items and auras, as Raider.io shapes them. */
  roster: unknown[];
}

interface GuildAnswer {
  region: RaiderIoRegion;
  /** The realm slug asked for. */
  realmSlug: string;
  fetchedAt: string;
  /** Served past its freshness because Raider.io could not be asked. */
  stale: boolean;
}

export interface GuildSummaryResponse extends GuildAnswer {
  guild: GuildBase;
  raidProgression: SummaryPart['raidProgression'];
  raidRankings: SummaryPart['raidRankings'];
  members: GuildMember[];
}

export interface GuildRosterResponse extends GuildAnswer {
  guild: GuildBase;
  /** Every member, in Raider.io's order. */
  members: GuildMember[];
}

export interface GuildRaidEncountersResponse extends GuildAnswer {
  guild: GuildBase;
  raid: string;
  difficulty: RaidDifficulty;
  encounters: RaidEncountersPart['encounters'];
}

export interface GuildBossKillResponse extends GuildAnswer {
  guildName: string;
  raid: string;
  boss: string;
  difficulty: RaidDifficulty;
  kill: BossKillPart['kill'];
  roster: unknown[];
}

/** `GET /pve/guild`: one of four shapes, by the parameters given. */
export type GuildResponse =
  GuildSummaryResponse | GuildRosterResponse | GuildRaidEncountersResponse | GuildBossKillResponse;
