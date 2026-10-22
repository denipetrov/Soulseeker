import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';
import type {
  RaiderIoBestRun,
  RaiderIoCharacterPayload,
} from '../../raiderio/schemas/character-profile.schema.js';
import type { MplusCharacterSyncInput } from '../../rankwarden/dto/mplus-character-sync.dto.js';
import type {
  FullPart,
  PveBestRun,
  PveCharacterBase,
  PveCharacterResponse,
  PveSeasonScores,
  RaidPart,
  SeasonPart,
} from './character.types.js';

/** What the whole page asks Raider.io for. */
export const FULL_FIELDS = [
  'gear',
  'talents:categorized',
  'guild',
  'raid_progression:current-expansion',
  'mythic_plus_scores_by_season:current',
  'mythic_plus_ranks',
  'mythic_plus_best_runs:all',
] as const;

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
    gender: payload.gender ?? null,
    faction: payload.faction ?? null,
    realm: payload.realm,
    region: payload.region,
    thumbnailUrl: payload.thumbnail_url ?? null,
  };
}

/** Only `season` and `scores`; the per-role colour `segments` are dropped. */
const scoresOf = (payload: RaiderIoCharacterPayload): PveSeasonScores[] =>
  (payload.mythic_plus_scores_by_season ?? []).map(({ season, scores }) => ({ season, scores }));

function bestRunOf(run: RaiderIoBestRun): PveBestRun {
  return {
    dungeon: run.dungeon,
    mythic_level: run.mythic_level,
    completed_at: run.completed_at,
    clear_time_ms: run.clear_time_ms,
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

export function fullPartOf(payload: RaiderIoCharacterPayload, fetchedAt: Date): FullPart {
  return {
    fetchedAt: fetchedAt.toISOString(),
    character: baseOf(payload),
    guild: payload.guild ? { name: payload.guild.name } : null,
    gear: payload.gear
      ? { itemLevelEquipped: payload.gear.item_level_equipped ?? null, items: payload.gear.items }
      : null,
    talentLoadout: payload.talentLoadout ?? null,
    raidProgression: payload.raid_progression ?? {},
    mythicPlusScores: scoresOf(payload),
    mythicPlusRanks: payload.mythic_plus_ranks ?? null,
    mythicPlusBestRuns: (payload.mythic_plus_best_runs ?? []).map(bestRunOf),
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

/** The parts one answer is built from: the whole page, or a raid and/or a season. */
export interface AnswerParts {
  full?: FullPart;
  raid?: RaidPart;
  season?: SeasonPart;
}

export function responseOf(
  region: RaiderIoRegion,
  realmSlug: string,
  parts: AnswerParts,
  stale: boolean,
): PveCharacterResponse {
  const present = [parts.full, parts.raid, parts.season].filter((part) => part !== undefined);
  const newest = present.reduce((a, b) => (a.fetchedAt >= b.fetchedAt ? a : b));
  const oldest = present.reduce((a, b) => (a.fetchedAt <= b.fetchedAt ? a : b));

  const response: PveCharacterResponse = {
    region,
    realmSlug,
    character: newest.character,
    fetchedAt: oldest.fetchedAt,
    stale,
  };

  if (parts.full) {
    response.guild = parts.full.guild;
    response.gear = parts.full.gear;
    response.talentLoadout = parts.full.talentLoadout;
    response.raidProgression = parts.full.raidProgression;
    response.mythicPlusScores = parts.full.mythicPlusScores;
    response.mythicPlusRanks = parts.full.mythicPlusRanks;
    response.mythicPlusBestRuns = parts.full.mythicPlusBestRuns;
  }
  if (parts.raid) {
    response.raidProgression = parts.raid.raidProgression;
    response.raidAchievementCurve = parts.raid.raidAchievementCurve;
  }
  if (parts.season) response.mythicPlusScores = parts.season.mythicPlusScores;

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
