import { DEFAULT_LOCALE, type Locale, type Region } from '../../blizzard/blizzard.constants.js';
import {
  statisticsById,
  type CharacterAchievementStatisticsPayload,
} from '../../blizzard/schemas/character-achievement-statistics.schema.js';
import type { CharacterEquipmentPayload } from '../../blizzard/schemas/character-equipment.schema.js';
import type { CharacterMediaPayload } from '../../blizzard/schemas/character-media.schema.js';
import type {
  CharacterProfilePayload,
  CharacterSpecializationsPayload,
} from '../../blizzard/schemas/character-profile.schema.js';
import type { CharacterStatisticsPayload } from '../../blizzard/schemas/character-statistics.schema.js';
import type { PvpBracketPayload } from '../../blizzard/schemas/pvp-bracket.schema.js';
import type { PvpSummaryPayload } from '../../blizzard/schemas/pvp-summary.schema.js';
import type { CharacterSyncInput } from '../../rankwarden/dto/character-sync.dto.js';
import type { Faction } from '../seasons/pvp-season.types.js';
import type {
  CorePart,
  HighestRatings,
  LocalizedPart,
  PvpCharacterResponse,
  PvpCharacterSpecializations,
  PvpCharacterStatistics,
  RatedStat,
  Talent,
} from './character.types.js';
import type { PvpHistoryEntry } from './pvp-history.js';

/**
 * A Blizzard payload without its API links: `_links`, and every `key: { href }`
 * reference. They point at Blizzard's API, which the front end cannot call, and
 * they are a good part of an equipment payload's size.
 */
export function withoutLinks<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutLinks(item) as unknown) as T;
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    if (name === '_links') continue;
    if (name === 'key' && field !== null && typeof field === 'object' && 'href' in field) continue;

    result[name] = withoutLinks(field);
  }

  return result as T;
}

const factionOf = (type: string | undefined): Faction | null => {
  const side = type?.toLowerCase();
  return side === 'alliance' || side === 'horde' ? side : null;
};

const ratedStat = (stat: CharacterStatisticsPayload['avoidance']): RatedStat | null =>
  stat
    ? {
        // Avoidance and speed have no `value`: their rating bonus is all of it.
        value: stat.value ?? stat.rating_bonus ?? null,
        rating: stat.rating_normalized ?? null,
      }
    : null;

function statisticsOf(payload: CharacterStatisticsPayload): PvpCharacterStatistics {
  return {
    avoidance: ratedStat(payload.avoidance),
    lifesteal: ratedStat(payload.lifesteal),
    speed: ratedStat(payload.speed),
    mastery: ratedStat(payload.mastery),
    meleeCrit: ratedStat(payload.melee_crit),
    meleeHaste: ratedStat(payload.melee_haste),
    versatility: payload.versatility ?? null,
    versatilityDamageDoneBonus: payload.versatility_damage_done_bonus ?? null,
  };
}

/** Each spec with its PvP talents and only its active loadout: about a quarter of the payload. */
function specializationsOf(payload: CharacterSpecializationsPayload): PvpCharacterSpecializations {
  return {
    activeSpecialization: payload.active_specialization ?? null,
    activeHeroTalentTree: payload.active_hero_talent_tree ?? null,
    specializations: (payload.specializations ?? []).map((entry) => {
      const active = entry.loadouts?.find((loadout) => loadout.is_active);

      return {
        specialization: entry.specialization,
        pvpTalentSlots: (entry.pvp_talent_slots ?? []).map((slot) => ({
          slotNumber: slot.slot_number,
          selected: slot.selected ? withoutLinks(slot.selected) : null,
        })),
        loadout: active
          ? {
              talentLoadoutCode: active.talent_loadout_code ?? null,
              heroTalentTree: active.selected_hero_talent_tree ?? null,
              classTalents: withoutLinks(active.selected_class_talents ?? []) as Talent[],
              specTalents: withoutLinks(active.selected_spec_talents ?? []) as Talent[],
              heroTalents: withoutLinks(active.selected_hero_talents ?? []) as Talent[],
            }
          : null,
      };
    }),
  };
}

/**
 * Achievement statistic ids of the highest personal ratings. Ids, not names:
 * they are the same in every language.
 */
export const HIGHEST_RATING_STATISTICS = { '2v2': 370, '3v3': 595, '5v5': 596 } as const;

export function highestRatingsOf(payload: CharacterAchievementStatisticsPayload): HighestRatings {
  const quantities = statisticsById(payload);
  const rating = (id: number) => {
    const value = quantities.get(id);
    // Blizzard reports a rating never reached as 0, and its team ratings as 2^32 - 2.
    return value !== undefined && value > 0 && value < 10_000 ? value : null;
  };

  return {
    '2v2': rating(HIGHEST_RATING_STATISTICS['2v2']),
    '3v3': rating(HIGHEST_RATING_STATISTICS['3v3']),
    '5v5': rating(HIGHEST_RATING_STATISTICS['5v5']),
  };
}

export interface CoreFetch {
  media: CharacterMediaPayload | null;
  summary: PvpSummaryPayload | null;
  brackets: { bracket: string; payload: PvpBracketPayload }[];
  statistics: CharacterStatisticsPayload | null;
  achievementStatistics: CharacterAchievementStatisticsPayload | null;
  pvpHistory: PvpHistoryEntry[];
}

export function corePartOf(fetched: CoreFetch, fetchedAt: Date): CorePart {
  const asset = (key: string) =>
    fetched.media?.assets.find((candidate) => candidate.key === key)?.value ?? null;

  return {
    fetchedAt: fetchedAt.toISOString(),
    seasonId: fetched.brackets.find(({ payload }) => payload.season)?.payload.season?.id ?? null,
    media: fetched.media ? { avatar: asset('avatar'), mainRaw: asset('main-raw') } : null,
    brackets: fetched.brackets.map(({ bracket, payload }) => ({
      bracket,
      rating: payload.rating,
      played: payload.season_match_statistics?.played ?? 0,
      won: payload.season_match_statistics?.won ?? 0,
      lost: payload.season_match_statistics?.lost ?? 0,
      specialization: payload.specialization ?? null,
      rounds: payload.season_round_statistics ?? null,
      // Both from Rankwarden, filled in per answer by the service; never cached.
      rank: null,
      previousRating: null,
    })),
    honor: fetched.summary
      ? {
          level: fetched.summary.honor_level ?? null,
          honorableKills: fetched.summary.honorable_kills ?? null,
        }
      : null,
    statistics: fetched.statistics ? statisticsOf(fetched.statistics) : null,
    highestRatings: fetched.achievementStatistics
      ? highestRatingsOf(fetched.achievementStatistics)
      : null,
    pvpHistory: fetched.pvpHistory,
  };
}

export interface LocalizedFetch {
  profile: CharacterProfilePayload;
  specializations: CharacterSpecializationsPayload | null;
  equipment: CharacterEquipmentPayload | null;
}

export function localizedPartOf(
  fetched: LocalizedFetch,
  locale: Locale,
  fetchedAt: Date,
): LocalizedPart {
  const { profile } = fetched;

  return {
    fetchedAt: fetchedAt.toISOString(),
    locale,
    profile: {
      id: profile.id,
      name: profile.name,
      realm: profile.realm,
      faction: factionOf(profile.faction?.type),
      level: profile.level,
      gender: profile.gender
        ? { type: profile.gender.type.toLowerCase(), name: profile.gender.name }
        : null,
      race: profile.race,
      class: profile.character_class,
      activeSpec: profile.active_spec ?? null,
      activeTitle: profile.active_title
        ? {
            id: profile.active_title.id,
            name: profile.active_title.name,
            displayString: profile.active_title.display_string,
          }
        : null,
      guild: profile.guild ?? null,
      averageItemLevel: profile.average_item_level ?? null,
      equippedItemLevel: profile.equipped_item_level ?? null,
      lastLoginAt:
        profile.last_login_timestamp === undefined
          ? null
          : new Date(profile.last_login_timestamp).toISOString(),
    },
    specializations: fetched.specializations ? specializationsOf(fetched.specializations) : null,
    equipment: fetched.equipment
      ? {
          items: withoutLinks(fetched.equipment.equipped_items),
          sets: withoutLinks(fetched.equipment.equipped_item_sets),
        }
      : null,
  };
}

export function responseOf(
  region: Region,
  core: CorePart,
  localized: LocalizedPart,
  stale: boolean,
): PvpCharacterResponse {
  return {
    region,
    locale: localized.locale,
    seasonId: core.seasonId,
    character: localized.profile,
    media: core.media,
    brackets: core.brackets,
    honor: core.honor,
    specializations: localized.specializations,
    statistics: core.statistics,
    // Cached before highest ratings were collected: absent until the part is refetched.
    highestRatings: core.highestRatings ?? null,
    equipment: localized.equipment,
    pvpHistory: core.pvpHistory,
    fetchedAt: core.fetchedAt < localized.fetchedAt ? core.fetchedAt : localized.fetchedAt,
    stale,
  };
}

/**
 * The body of Rankwarden's `POST /characters/sync`, or null when there is
 * nothing it could store: a character with no rating this season.
 *
 * `brackets` is every ladder pvp-summary listed, because Rankwarden replaces
 * the whole set. The profile goes along only when the names are English:
 * Rankwarden stores them, and a translated class name would show on every
 * page that reads them.
 */
export function syncPayloadOf(
  region: Region,
  core: CorePart,
  localized: LocalizedPart,
): CharacterSyncInput | null {
  if (core.seasonId === null || core.brackets.length === 0) return null;

  const { profile, specializations } = localized;
  const fetchedAt = new Date(core.fetchedAt);

  const payload: CharacterSyncInput = {
    seasonId: core.seasonId,
    region,
    characterId: profile.id,
    characterName: profile.name,
    realmId: profile.realm.id,
    realmSlug: profile.realm.slug,
    faction: profile.faction?.toUpperCase() ?? null,
    brackets: Object.fromEntries(
      core.brackets.map((entry) => {
        // Rankwarden's sweep stores what Blizzard's leaderboard counts, which for
        // Solo Shuffle is rounds, not matches: sending matches would undo it.
        const record = entry.rounds ?? entry;

        return [
          entry.bracket,
          {
            rating: entry.rating,
            played: record.played,
            won: record.won,
            lost: record.lost,
            fetchedAt,
          },
        ];
      }),
    ),
  };

  if (localized.locale !== DEFAULT_LOCALE) return payload;

  return {
    ...payload,
    profile: {
      race: profile.race,
      class: profile.class,
      spec: profile.activeSpec,
      level: profile.level,
      gender: profile.gender?.type.toUpperCase() ?? null,
      guild: profile.guild,
      realmName: profile.realm.name,
      title: profile.activeTitle?.displayString ?? null,
      averageItemLevel: profile.averageItemLevel,
      equippedItemLevel: profile.equippedItemLevel,
      lastLoginAt: profile.lastLoginAt === null ? null : new Date(profile.lastLoginAt),
      ...(specializations && {
        heroTalentTree: specializations.activeHeroTalentTree,
        talentLoadouts: specializations.specializations.flatMap(({ specialization, loadout }) =>
          loadout
            ? [
                {
                  spec: specialization,
                  talentLoadoutCode: loadout.talentLoadoutCode,
                  heroTalentTree: loadout.heroTalentTree,
                },
              ]
            : [],
        ),
      }),
    },
  };
}
