import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { fillPath } from '../common/utils/path-template.js';
import type { Env } from '../config/env.schema.js';
import type { Locale, Region } from './blizzard.constants.js';
import { BlizzardApiError } from './http/blizzard-api.error.js';
import { BlizzardHttpService } from './http/blizzard-http.service.js';
import {
  characterAchievementStatisticsSchema,
  type CharacterAchievementStatisticsPayload,
} from './schemas/character-achievement-statistics.schema.js';
import {
  characterAchievementsSchema,
  type CharacterAchievementsPayload,
} from './schemas/character-achievements.schema.js';
import {
  characterEquipmentSchema,
  type CharacterEquipmentPayload,
} from './schemas/character-equipment.schema.js';
import {
  characterMediaSchema,
  type CharacterMediaPayload,
} from './schemas/character-media.schema.js';
import {
  characterProfileSchema,
  characterSpecializationsSchema,
  type CharacterProfilePayload,
  type CharacterSpecializationsPayload,
} from './schemas/character-profile.schema.js';
import {
  characterStatisticsSchema,
  type CharacterStatisticsPayload,
} from './schemas/character-statistics.schema.js';
import { pvpBracketSchema, type PvpBracketPayload } from './schemas/pvp-bracket.schema.js';
import { pvpSummarySchema, type PvpSummaryPayload } from './schemas/pvp-summary.schema.js';

/**
 * Typed access to the per-character Profile API endpoints.
 *
 * Every method resolves to null when the character (or, for a bracket, their
 * standing on it) does not exist: renamed, transferred, deleted, or never
 * played that ladder. Endpoint paths come from configuration. `locale` picks
 * the language of the names in the answer; without it, `BLIZZARD_LOCALE`.
 */
@Injectable()
export class ProfileApi {
  private readonly logger = new RunLogger(ProfileApi.name);

  private readonly profilePath: string;
  private readonly specializationsPath: string;
  private readonly pvpBracketPath: string;
  private readonly mediaPath: string;
  private readonly pvpSummaryPath: string;
  private readonly statisticsPath: string;
  private readonly equipmentPath: string;
  private readonly achievementsPath: string;
  private readonly achievementStatisticsPath: string;

  constructor(
    private readonly http: BlizzardHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.profilePath = config.get('BLIZZARD_PATH_CHARACTER_PROFILE', { infer: true });
    this.specializationsPath = config.get('BLIZZARD_PATH_CHARACTER_SPECIALIZATIONS', {
      infer: true,
    });
    this.pvpBracketPath = config.get('BLIZZARD_PATH_CHARACTER_PVP_BRACKET', { infer: true });
    this.mediaPath = config.get('BLIZZARD_PATH_CHARACTER_MEDIA', { infer: true });
    this.pvpSummaryPath = config.get('BLIZZARD_PATH_CHARACTER_PVP_SUMMARY', { infer: true });
    this.statisticsPath = config.get('BLIZZARD_PATH_CHARACTER_STATISTICS', { infer: true });
    this.equipmentPath = config.get('BLIZZARD_PATH_CHARACTER_EQUIPMENT', { infer: true });
    this.achievementsPath = config.get('BLIZZARD_PATH_CHARACTER_ACHIEVEMENTS', { infer: true });
    this.achievementStatisticsPath = config.get('BLIZZARD_PATH_CHARACTER_ACHIEVEMENT_STATISTICS', {
      infer: true,
    });
  }

  /**
   * Character names are case-insensitive in the API but must be lowercased and
   * percent-encoded — ladders are full of names like "Zëph".
   */
  private path(
    template: string,
    realmSlug: string,
    characterName: string,
    extra: Record<string, string> = {},
  ): string {
    return fillPath(template, {
      realmSlug,
      characterName: encodeURIComponent(characterName.toLowerCase()),
      ...extra,
    });
  }

  getProfile(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterProfilePayload | null> {
    return this.fetch(
      region,
      this.path(this.profilePath, realmSlug, characterName),
      characterProfileSchema.parse,
      locale,
    );
  }

  getSpecializations(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterSpecializationsPayload | null> {
    return this.fetch(
      region,
      this.path(this.specializationsPath, realmSlug, characterName),
      characterSpecializationsSchema.parse,
      locale,
    );
  }

  /** `bracket` as Blizzard names it: `3v3`, `shuffle-mage-fire`, … */
  getPvpBracket(
    region: Region,
    realmSlug: string,
    characterName: string,
    bracket: string,
    locale?: Locale,
  ): Promise<PvpBracketPayload | null> {
    return this.fetch(
      region,
      this.path(this.pvpBracketPath, realmSlug, characterName, {
        bracket: encodeURIComponent(bracket),
      }),
      pvpBracketSchema.parse,
      locale,
    );
  }

  getMedia(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterMediaPayload | null> {
    return this.fetch(
      region,
      this.path(this.mediaPath, realmSlug, characterName),
      characterMediaSchema.parse,
      locale,
    );
  }

  getPvpSummary(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<PvpSummaryPayload | null> {
    return this.fetch(
      region,
      this.path(this.pvpSummaryPath, realmSlug, characterName),
      pvpSummarySchema.parse,
      locale,
    );
  }

  getStatistics(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterStatisticsPayload | null> {
    return this.fetch(
      region,
      this.path(this.statisticsPath, realmSlug, characterName),
      characterStatisticsSchema.parse,
      locale,
    );
  }

  getEquipment(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterEquipmentPayload | null> {
    return this.fetch(
      region,
      this.path(this.equipmentPath, realmSlug, characterName),
      characterEquipmentSchema.parse,
      locale,
    );
  }

  getAchievements(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterAchievementsPayload | null> {
    return this.fetch(
      region,
      this.path(this.achievementsPath, realmSlug, characterName),
      characterAchievementsSchema.parse,
      locale,
    );
  }

  getAchievementStatistics(
    region: Region,
    realmSlug: string,
    characterName: string,
    locale?: Locale,
  ): Promise<CharacterAchievementStatisticsPayload | null> {
    return this.fetch(
      region,
      this.path(this.achievementStatisticsPath, realmSlug, characterName),
      characterAchievementStatisticsSchema.parse,
      locale,
    );
  }

  private async fetch<T>(
    region: Region,
    path: string,
    parse: (input: unknown) => T,
    locale?: Locale,
  ) {
    try {
      return parse(await this.http.get(region, path, { namespace: 'profile', locale }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.isNotFound) {
        this.logger.debug(`Not found: ${region}/${path}`);
        return null;
      }
      throw error;
    }
  }
}
