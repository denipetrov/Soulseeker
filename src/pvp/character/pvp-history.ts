import type { CharacterAchievementsPayload } from '../../blizzard/schemas/character-achievements.schema.js';
import {
  CORE_BRACKETS,
  type PvpSeason,
  type PvpSeasonSummary,
} from '../seasons/pvp-season.types.js';

/** The rated PvP achievements that mark a season's standing; `rank-one` is any Rank 1 title. */
export const PVP_TIERS = [
  'combatant',
  'challenger',
  'rival',
  'duelist',
  'elite',
  'battle-mender',
  'strategist',
  'legend',
  'gladiator',
  'rank-one',
] as const;
export type PvpTier = (typeof PVP_TIERS)[number];

/** One PvP title the account earned, newest first in a history. */
export interface PvpHistoryEntry {
  achievementId: number;
  /** As Blizzard names it, in English: `Duelist: Midnight Season 2`. */
  name: string;
  tier: PvpTier;
  /** 1 or 2 for the split tiers since Shadowlands Season 2 (`Rival II`); null otherwise. */
  division: 1 | 2 | null;
  /** `The War Within`, `Warlords`; null for names without one (`Challenger: Season 14`). */
  expansion: string | null;
  /** The season within the expansion as the name gives it; Blizzard's own numbering before Warlords. */
  seasonNumber: number | null;
  /** Blizzard's PvP season id, where Rankwarden knows the season (27 onwards). */
  seasonId: number | null;
  /**
   * The ladder of a Rank 1 title, from Rankwarden's season rewards: `3v3`, `rbg`,
   * or the family `shuffle` / `blitz` when one title covers every spec.
   */
  bracket: string | null;
  completedAt: string;
  /**
   * Achievements are account-wide. True when this character completed it, false
   * when another character of the account did.
   */
  earnedByThisCharacter: boolean;
}

/** What a Rank 1 title's achievement id is known to stand for. */
interface RankOneTitle {
  seasonId: number;
  bracket: string;
}

/** The parts of a season the history reads: its id, start, and its titles' achievement ids. */
export type HistorySeason = Pick<PvpSeason, 'seasonId' | 'startsAt' | 'cutoffs' | 'specCutoffs'>;

/**
 * `Gladiator: The War Within Season 1`, `Rival II: Midnight Season 2`,
 * `Duelist: Warlords Season 3`, `Challenger: Season 14`. Names are matched in
 * English, which is why achievements are always fetched in `en_US`.
 */
const TIER_PATTERN =
  /^(Combatant|Challenger|Rival|Duelist|Elite|Gladiator|Legend|Strategist|Battle Mender)(?: (I|II))?: (?:(.+?) )?Season (\d+)$/;

/**
 * Rank 1 titles in seasons Rankwarden has no rewards for: `Dread Gladiator:
 * Battle for Azeroth Season 1`, `Crimson Legend: Dragonflight Season 1`, and
 * `Hero of the Alliance: Draconic`, which names no season.
 */
const RANK_ONE_PATTERN = /^\S+ (?:Gladiator|Legend): (?:(.+?) )?Season (\d+)$/;
const HERO_PATTERN = /^Hero of the (?:Alliance|Horde): \S+$/;

const tierOf = (name: string): PvpTier => name.toLowerCase().replace(' ', '-') as PvpTier;

/**
 * Every Rank 1 title's achievement id in the region's seasons, with the season
 * and ladder it was awarded for. One id shared by several spec ladders (every
 * Shuffle spec earns the same Legend title) stands for the family.
 */
function rankOneTitles(seasons: readonly HistorySeason[]): Map<number, RankOneTitle> {
  const titles = new Map<number, RankOneTitle>();

  const add = (achievementId: number | null, seasonId: number, bracket: string) => {
    if (achievementId === null) return;

    const known = titles.get(achievementId);
    if (known && known.bracket !== bracket) {
      titles.set(achievementId, { seasonId, bracket: bracket.split('-')[0]! });
    } else {
      titles.set(achievementId, { seasonId, bracket });
    }
  };

  for (const season of seasons) {
    const cutoffs = [
      ...CORE_BRACKETS.map((bracket) => ({ bracket, cutoff: season.cutoffs[bracket] })),
      ...Object.values(season.specCutoffs).flatMap((ladders) =>
        Object.values(ladders).map((cutoff) => ({ bracket: cutoff.bracket, cutoff })),
      ),
    ];

    for (const { bracket, cutoff } of cutoffs) {
      if (!cutoff) continue;

      add(cutoff.achievementId, season.seasonId, bracket);
      for (const side of Object.values(cutoff.factions ?? {})) {
        add(side.achievementId, season.seasonId, bracket);
      }
    }
  }

  return titles;
}

/**
 * The season a moment falls in: the newest one that had started by then. A
 * moment before the oldest known season has none.
 */
function seasonAt(seasons: readonly Pick<PvpSeasonSummary, 'seasonId' | 'startsAt'>[], at: number) {
  let found: { seasonId: number; startsAt: number } | null = null;

  for (const season of seasons) {
    if (!season.startsAt) continue;

    const startsAt = Date.parse(season.startsAt);
    if (startsAt <= at && (!found || startsAt > found.startsAt)) {
      found = { seasonId: season.seasonId, startsAt };
    }
  }

  return found?.seasonId ?? null;
}

/**
 * The account's PvP titles, from its achievements: the seasonal tiers by name,
 * and the Rank 1 titles by the achievement ids Rankwarden recorded for each
 * season's rewards, by name where it has none.
 *
 * Everything else — about 5,000 achievements for an active account — is left
 * out, so only this short list is ever cached. Unearned achievements carry no
 * timestamp and are left out too.
 */
export function pvpHistoryOf(
  payload: CharacterAchievementsPayload,
  seasons: readonly HistorySeason[],
): PvpHistoryEntry[] {
  const rankOne = rankOneTitles(seasons);
  const entries: PvpHistoryEntry[] = [];

  for (const { achievement, criteria, completed_timestamp: completedAt } of payload.achievements) {
    if (completedAt === undefined) continue;

    const base = {
      achievementId: achievement.id,
      name: achievement.name,
      completedAt: new Date(completedAt).toISOString(),
      earnedByThisCharacter: criteria?.is_completed === true,
    };

    const title = rankOne.get(achievement.id);
    const tier = TIER_PATTERN.exec(achievement.name);
    const rankOneByName = RANK_ONE_PATTERN.exec(achievement.name);

    if (title) {
      entries.push({
        ...base,
        tier: 'rank-one',
        division: null,
        expansion: rankOneByName ? (rankOneByName[1] ?? null) : (tier?.[3] ?? null),
        seasonNumber: rankOneByName ? Number(rankOneByName[2]) : tier ? Number(tier[4]) : null,
        seasonId: title.seasonId,
        bracket: title.bracket,
      });
    } else if (tier) {
      entries.push({
        ...base,
        tier: tierOf(tier[1]!),
        division: tier[2] === 'II' ? 2 : tier[2] === 'I' ? 1 : null,
        expansion: tier[3] ?? null,
        seasonNumber: Number(tier[4]),
        seasonId: seasonAt(seasons, completedAt),
        bracket: null,
      });
    } else if (rankOneByName || HERO_PATTERN.test(achievement.name)) {
      entries.push({
        ...base,
        tier: 'rank-one',
        division: null,
        expansion: rankOneByName?.[1] ?? null,
        seasonNumber: rankOneByName ? Number(rankOneByName[2]) : null,
        seasonId: null,
        // A name alone does not say which ladder: Legend titles have covered
        // both Shuffle and Blitz, Hero titles both RBG and Blitz.
        bracket: null,
      });
    }
  }

  return entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}
