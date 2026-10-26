import type { RaidDifficulty } from '@denipetrov/spirit-link/constants';

import type {
  RaiderIoBossKillPayload,
  RaiderIoGuildPayload,
} from '../../raiderio/schemas/guild-profile.schema.js';
import type {
  BossKillPart,
  GuildBase,
  GuildMember,
  RaidEncountersPart,
  SummaryPart,
} from './guild.types.js';

/** What the summary asks Raider.io for. */
export const SUMMARY_FIELDS = [
  'raid_progression:current-expansion',
  'raid_rankings:current-expansion',
  'members',
] as const;

export const ROSTER_FIELDS = ['members'] as const;

export const raidEncountersFields = (raid: string, difficulty: RaidDifficulty) => [
  `raid_encounters:${raid}:${difficulty}`,
];

/** The ranks the summary keeps: the guild master and the rank below. */
export const SUMMARY_RANKS: readonly number[] = [0, 1];

export function guildBaseOf(payload: RaiderIoGuildPayload): GuildBase {
  return {
    name: payload.name,
    displayName: payload.displayName ?? null,
    faction: payload.faction ?? null,
    realm: payload.realm,
    region: payload.region,
    profileUrl: payload.profile_url ?? null,
    lastCrawledAt: payload.last_crawled_at ?? null,
  };
}

export function membersOf(payload: RaiderIoGuildPayload): GuildMember[] {
  return (payload.members ?? []).map(({ rank, character }) => ({ rank, character }));
}

/**
 * The summary: progression, rankings, and only the members of ranks 0 and 1,
 * guild master first. A large guild has ~1,000 members (~350 KB); the summary
 * keeps about a tenth of that.
 */
export function summaryPartOf(payload: RaiderIoGuildPayload, fetchedAt: Date): SummaryPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    guild: guildBaseOf(payload),
    raidProgression: payload.raid_progression ?? {},
    raidRankings: payload.raid_rankings ?? {},
    members: membersOf(payload)
      .filter((member) => SUMMARY_RANKS.includes(member.rank))
      .sort((a, b) => a.rank - b.rank),
  };
}

export function raidEncountersPartOf(
  payload: RaiderIoGuildPayload,
  fetchedAt: Date,
): RaidEncountersPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    guild: guildBaseOf(payload),
    encounters: payload.raid_encounters ?? [],
  };
}

/** Raider.io's answer as it comes; `{}` (no kill yet) becomes no kill and no roster. */
export function bossKillPartOf(payload: RaiderIoBossKillPayload, fetchedAt: Date): BossKillPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    kill: payload.kill ?? null,
    roster: payload.roster ?? [],
  };
}
