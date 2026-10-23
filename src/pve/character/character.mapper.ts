import type { CharacterRaidEncountersPayload } from '../../blizzard/schemas/character-raid-encounters.schema.js';
import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';
import type {
  RaiderIoBestRun,
  RaiderIoCharacterPayload,
} from '../../raiderio/schemas/character-profile.schema.js';
import type { MplusCharacterSyncInput } from '../../rankwarden/dto/mplus-character-sync.dto.js';
import type { CatalogueMplusSeason, CatalogueRaid } from '../../seasons/pve-catalogue.service.js';
import {
  RAID_DIFFICULTIES,
  type BossesPart,
  type FullPart,
  type PveCharacterBase,
  type PveCharacterResponse,
  type PveRun,
  type PveSeasonScores,
  type RaidBoss,
  type RaidDifficulty,
  type RaidPart,
  type SeasonPart,
  type TopPercent,
} from './character.types.js';

/**
 * What the whole page asks Raider.io for. `currentRaids` are the slugs of the
 * current expansion's raids, from the catalogue, for their AOTC / Cutting Edge.
 */
export function fullFields(currentRaids: readonly string[]): string[] {
  return [
    'gear',
    'talents:categorized',
    'guild',
    'raid_progression:current-expansion',
    ...(currentRaids.length > 0 ? [`raid_achievement_curve:${currentRaids.join(':')}`] : []),
    'mythic_plus_scores_by_season:current:previous',
    'mythic_plus_ranks',
    'mythic_plus_best_runs:all',
    'mythic_plus_recent_runs',
    'mythic_plus_highest_level_runs',
    'mythic_plus_weekly_highest_level_runs',
    'mythic_plus_previous_weekly_highest_level_runs',
  ];
}

export const raidFields = (slug: string) => [
  `raid_progression:${slug}`,
  `raid_achievement_curve:${slug}`,
];

export const seasonFields = (slug: string) => [`mythic_plus_scores_by_season:${slug}`];

function baseOf(payload: RaiderIoCharacterPayload): PveCharacterBase {
  return {
    name: payload.name,
    race: payload.race,
    class: payload.class,
    activeSpecName: payload.active_spec_name ?? null,
    activeSpecRole: payload.active_spec_role ?? null,
    gender: payload.gender ?? null,
    faction: payload.faction ?? null,
    realm: payload.realm,
    region: payload.region,
    thumbnailUrl: payload.thumbnail_url ?? null,
    achievementPoints: payload.achievement_points ?? null,
    profileBanner: payload.profile_banner ?? null,
    profileUrl: payload.profile_url ?? null,
    lastCrawledAt: payload.last_crawled_at ?? null,
  };
}

/** `season` and `scores`, with each score's colour taken from Raider.io's `segments`. */
const scoresOf = (payload: RaiderIoCharacterPayload): Omit<PveSeasonScores, 'topPercent'>[] =>
  (payload.mythic_plus_scores_by_season ?? []).map(({ season, scores, segments }) => ({
    season,
    scores,
    colors: Object.fromEntries(
      Object.entries(segments ?? {}).map(([key, segment]) => [key, segment.color]),
    ),
  }));

function runOf(run: RaiderIoBestRun): PveRun {
  return {
    dungeon: run.dungeon,
    mythic_level: run.mythic_level,
    completed_at: run.completed_at,
    clear_time_ms: run.clear_time_ms,
    par_time_ms: run.par_time_ms ?? null,
    num_keystone_upgrades: run.num_keystone_upgrades ?? null,
    score: run.score,
    icon_url: run.icon_url ?? null,
    background_image_url: run.background_image_url ?? null,
    url: run.url ?? null,
    affixes: (run.affixes ?? []).map((affix) => ({
      id: affix.id,
      icon_url: affix.icon_url ?? null,
      wowhead_url: affix.wowhead_url ?? null,
    })),
    spec: run.spec ? { id: run.spec.id } : null,
    role: run.role ?? null,
  };
}

const runsOf = (runs: RaiderIoBestRun[] | undefined): PveRun[] => (runs ?? []).map(runOf);

export function fullPartOf(payload: RaiderIoCharacterPayload, fetchedAt: Date): FullPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    character: baseOf(payload),
    guild: payload.guild ? { name: payload.guild.name, realm: payload.guild.realm ?? null } : null,
    gear: payload.gear
      ? { itemLevelEquipped: payload.gear.item_level_equipped ?? null, items: payload.gear.items }
      : null,
    talentLoadout: payload.talentLoadout ?? null,
    raidProgression: payload.raid_progression ?? {},
    raidAchievementCurve: payload.raid_achievement_curve ?? [],
    mythicPlusScores: scoresOf(payload),
    mythicPlusRanks: payload.mythic_plus_ranks ?? null,
    mythicPlusBestRuns: runsOf(payload.mythic_plus_best_runs),
    mythicPlusRecentRuns: runsOf(payload.mythic_plus_recent_runs),
    mythicPlusHighestLevelRuns: runsOf(payload.mythic_plus_highest_level_runs),
    mythicPlusWeeklyHighestLevelRuns: runsOf(payload.mythic_plus_weekly_highest_level_runs),
    mythicPlusPreviousWeeklyHighestLevelRuns: runsOf(
      payload.mythic_plus_previous_weekly_highest_level_runs,
    ),
  };
}

export function raidPartOf(
  payload: RaiderIoCharacterPayload,
  slug: string,
  fetchedAt: Date,
): RaidPart {
  const progression = payload.raid_progression?.[slug];

  return {
    fetchedAt: fetchedAt.toISOString(),
    character: baseOf(payload),
    raidProgression: progression ? { [slug]: progression } : {},
    raidAchievementCurve: payload.raid_achievement_curve ?? [],
  };
}

export function seasonPartOf(payload: RaiderIoCharacterPayload, fetchedAt: Date): SeasonPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    character: baseOf(payload),
    mythicPlusScores: scoresOf(payload),
  };
}

/**
 * Whether a score is within the region's top 0.1% or top 1% of its season,
 * by the season's cutoffs in the catalogue.
 */
export function topPercentOf(
  score: number,
  season: CatalogueMplusSeason | undefined,
  region: string,
): TopPercent | null {
  const cutoffs = season?.cutoffs[region];
  if (!cutoffs || score <= 0) return null;

  if (cutoffs.p999 !== null && score >= cutoffs.p999)
    return { percent: 0.1, minScore: cutoffs.p999 };
  if (cutoffs.p990 !== null && score >= cutoffs.p990) return { percent: 1, minScore: cutoffs.p990 };

  return null;
}

/** A name compared across Blizzard and Raider.io: no case, accents, spaces or punctuation. */
const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The same, short: without a leading "The" and anything after a comma. The two
 * sites disagree on exactly those: Blizzard's "Sikran, Captain of the Sureki"
 * and "The One-Armed Bandit" are Raider.io's "Sikran" and "One-Armed Bandit".
 */
const shortNameKey = (name: string) => nameKey(name.split(',')[0]!.replace(/^the\s+/i, ''));

const difficultyOf = (type: string): RaidDifficulty | null => {
  const key = type.toLowerCase();
  return (RAID_DIFFICULTIES as readonly string[]).includes(key) ? (key as RaidDifficulty) : null;
};

/**
 * Each catalogue raid's bosses with the character's kills, from Blizzard's raid
 * encounters.
 *
 * Bosses are matched by name: Blizzard's encounter ids are not Raider.io's,
 * and a Raider.io tier such as `tier-mn-1` spans several Blizzard instances.
 * The full name is tried first, then the short one. A name killed in more than
 * one expansion counts the newest. A boss the character never killed has no
 * kills.
 */
export function bossesPartOf(
  payload: CharacterRaidEncountersPayload,
  raids: readonly CatalogueRaid[],
  fetchedAt: Date,
): BossesPart {
  const kills = new Map<string, RaidBoss['kills']>();
  /** Short name → full name, of every boss Blizzard listed. */
  const shortNames = new Map<string, string>();

  // Oldest expansion first, as Blizzard lists them: a newer one overwrites.
  for (const { instances } of payload.expansions) {
    for (const { modes } of instances) {
      for (const { difficulty, progress } of modes) {
        const key = difficultyOf(difficulty.type);
        if (!key) continue;

        for (const { encounter, completed_count, last_kill_timestamp } of progress.encounters) {
          const name = nameKey(encounter.name);
          const boss = kills.get(name) ?? {};
          boss[key] = {
            count: completed_count,
            lastKillAt:
              last_kill_timestamp === undefined
                ? null
                : new Date(last_kill_timestamp).toISOString(),
          };
          kills.set(name, boss);
          shortNames.set(shortNameKey(encounter.name), name);
        }
      }
    }
  }

  return {
    fetchedAt: fetchedAt.toISOString(),
    raids: Object.fromEntries(
      raids.map((raid) => [
        raid.slug,
        raid.encounters.map(({ slug, name }) => ({
          slug,
          name,
          kills:
            kills.get(nameKey(name)) ?? kills.get(shortNames.get(shortNameKey(name)) ?? '') ?? {},
        })),
      ]),
    ),
  };
}

/** The parts one answer is built from: the whole page, or a raid and/or a season. */
export interface AnswerParts {
  full?: FullPart;
  raid?: RaidPart;
  season?: SeasonPart;
}

/** What an answer is completed with besides its Raider.io parts. */
export interface AnswerExtras {
  /** The catalogue's seasons, for each score's top 0.1% / 1%. */
  mplusSeasons: readonly CatalogueMplusSeason[];
  /** The raids whose bosses the answer shows; none for a season-only answer. */
  bossRaids: readonly string[];
  /** Per-boss kills, or null when Blizzard could not be asked. */
  bosses: BossesPart | null;
}

export function responseOf(
  region: RaiderIoRegion,
  realmSlug: string,
  parts: AnswerParts,
  extras: AnswerExtras,
  stale: boolean,
): PveCharacterResponse {
  const present = [parts.full, parts.raid, parts.season].filter((part) => part !== undefined);
  const newest = present.reduce((a, b) => (a.fetchedAt >= b.fetchedAt ? a : b));
  const oldest = present.reduce((a, b) => (a.fetchedAt <= b.fetchedAt ? a : b));

  const withTopPercent = (scores: Omit<PveSeasonScores, 'topPercent'>[]): PveSeasonScores[] =>
    scores.map((entry) => ({
      ...entry,
      topPercent: topPercentOf(
        typeof entry.scores.all === 'number' ? entry.scores.all : 0,
        extras.mplusSeasons.find((season) => season.slug === entry.season),
        region,
      ),
    }));

  const response: PveCharacterResponse = {
    region,
    realmSlug,
    character: newest.character,
    fetchedAt: oldest.fetchedAt,
    stale,
  };

  if (parts.full) {
    const { full } = parts;
    response.guild = full.guild;
    response.gear = full.gear;
    response.talentLoadout = full.talentLoadout;
    response.raidProgression = full.raidProgression;
    // Cached before the curve was asked for on the whole page: empty until refetched.
    response.raidAchievementCurve = full.raidAchievementCurve ?? [];
    response.mythicPlusScores = withTopPercent(full.mythicPlusScores);
    response.mythicPlusRanks = full.mythicPlusRanks;
    response.mythicPlusBestRuns = full.mythicPlusBestRuns;
    response.mythicPlusRecentRuns = full.mythicPlusRecentRuns ?? [];
    response.mythicPlusHighestLevelRuns = full.mythicPlusHighestLevelRuns ?? [];
    response.mythicPlusWeeklyHighestLevelRuns = full.mythicPlusWeeklyHighestLevelRuns ?? [];
    response.mythicPlusPreviousWeeklyHighestLevelRuns =
      full.mythicPlusPreviousWeeklyHighestLevelRuns ?? [];
  }
  if (parts.raid) {
    response.raidProgression = parts.raid.raidProgression;
    response.raidAchievementCurve = parts.raid.raidAchievementCurve;
  }
  if (parts.season) response.mythicPlusScores = withTopPercent(parts.season.mythicPlusScores);

  if (extras.bossRaids.length > 0) {
    const { bosses } = extras;
    response.raidBosses = bosses
      ? Object.fromEntries(extras.bossRaids.map((slug) => [slug, bosses.raids[slug] ?? []]))
      : null;
  }

  return response;
}

/**
 * The dungeon slug from a run's Raider.io url:
 * `…/mythic-plus-runs/season-mn-2/14738020-14-temple-of-sethraliss` → `temple-of-sethraliss`.
 */
export function dungeonSlugOf(url: string | undefined): string | null {
  const last = url?.split('?')[0]?.split('/').filter(Boolean).at(-1);
  const match = last ? /^\d+-\d+-([a-z0-9-]+)$/.exec(last) : null;

  return match ? match[1]! : null;
}

/**
 * A role as runs and Rankwarden spell it. The base profile's
 * `active_spec_role` says `HEALING` / `TANK` / `DPS` where a run says `healer`.
 */
export function roleOf(role: string | null | undefined): string | null {
  switch (role?.toUpperCase()) {
    case 'HEALING':
    case 'HEALER':
      return 'healer';
    case 'TANK':
      return 'tank';
    case 'DPS':
      return 'dps';
    default:
      return null;
  }
}

/**
 * The body of Rankwarden's `POST /mplus/characters/sync` for the current
 * season, or null when there is no run to send.
 *
 * Runs of a dungeon the season does not list are left out: Rankwarden refuses
 * the whole request for one of them. So are runs whose dungeon cannot be
 * identified. Rankwarden merges runs per dungeon and never lowers a score, so
 * sending the best runs as Raider.io has them is always safe.
 */
export function syncPayloadOf(
  region: RaiderIoRegion,
  realmSlug: string,
  payload: RaiderIoCharacterPayload,
  seasonDungeonIds: readonly number[],
): MplusCharacterSyncInput | null {
  const season = payload.mythic_plus_scores_by_season?.[0]?.season;
  if (!season) return null;

  const dungeons = new Set(seasonDungeonIds);
  const dungeonRuns = (payload.mythic_plus_best_runs ?? []).flatMap((run) => {
    const slug = dungeonSlugOf(run.url);
    if (run.zone_id === undefined || !dungeons.has(run.zone_id) || !slug) return [];
    if (run.mythic_level <= 0) return [];

    return [
      {
        dungeon: { id: run.zone_id, name: run.dungeon, slug, shortName: run.short_name },
        keystoneRunId: run.keystone_run_id,
        mythicLevel: run.mythic_level,
        score: run.score,
        clearTimeMs: run.clear_time_ms,
        timeRemainingMs:
          run.par_time_ms === null || run.par_time_ms === undefined
            ? null
            : run.par_time_ms - run.clear_time_ms,
        numChests: run.num_keystone_upgrades ?? null,
        completedAt: new Date(run.completed_at),
        specId: run.spec?.id ?? null,
        role: run.role ?? roleOf(payload.active_spec_role) ?? 'dps',
      },
    ];
  });

  if (dungeonRuns.length === 0) return null;

  return {
    season,
    region,
    realmSlug,
    characterName: payload.name,
    realmName: payload.realm,
    faction: payload.faction ?? null,
    dungeonRuns,
    profile: {
      className: payload.class,
      specName: payload.active_spec_name ?? null,
      raceName: payload.race,
      role: roleOf(payload.active_spec_role),
    },
  };
}
