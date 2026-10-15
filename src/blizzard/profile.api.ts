import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { fillPath } from '../common/utils/path-template.js';
import type { Env } from '../config/env.schema.js';
import type { Region } from './blizzard.constants.js';
import { BlizzardApiError } from './http/blizzard-api.error.js';
import { BlizzardHttpService } from './http/blizzard-http.service.js';
import {
  characterProfileSchema,
  characterSpecializationsSchema,
  type CharacterProfilePayload,
  type CharacterSpecializationsPayload,
} from './schemas/character-profile.schema.js';
import { pvpBracketSchema, type PvpBracketPayload } from './schemas/pvp-bracket.schema.js';

/**
 * Typed access to the per-character Profile API endpoints.
 *
 * Every method resolves to null when the character (or, for a bracket, their
 * standing on it) does not exist: renamed, transferred, deleted, or never
 * played that ladder. Endpoint paths come from configuration.
 */
@Injectable()
export class ProfileApi {
  private readonly logger = new RunLogger(ProfileApi.name);

  private readonly profilePath: string;
  private readonly specializationsPath: string;
  private readonly pvpBracketPath: string;

  constructor(
    private readonly http: BlizzardHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.profilePath = config.get('BLIZZARD_PATH_CHARACTER_PROFILE', { infer: true });
    this.specializationsPath = config.get('BLIZZARD_PATH_CHARACTER_SPECIALIZATIONS', {
      infer: true,
    });
    this.pvpBracketPath = config.get('BLIZZARD_PATH_CHARACTER_PVP_BRACKET', { infer: true });
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
  ): Promise<CharacterProfilePayload | null> {
    return this.fetch(
      region,
      this.path(this.profilePath, realmSlug, characterName),
      characterProfileSchema.parse,
    );
  }

  getSpecializations(
    region: Region,
    realmSlug: string,
    characterName: string,
  ): Promise<CharacterSpecializationsPayload | null> {
    return this.fetch(
      region,
      this.path(this.specializationsPath, realmSlug, characterName),
      characterSpecializationsSchema.parse,
    );
  }

  /** `bracket` as Blizzard names it: `3v3`, `shuffle-mage-fire`, … */
  getPvpBracket(
    region: Region,
    realmSlug: string,
    characterName: string,
    bracket: string,
  ): Promise<PvpBracketPayload | null> {
    return this.fetch(
      region,
      this.path(this.pvpBracketPath, realmSlug, characterName, {
        bracket: encodeURIComponent(bracket),
      }),
      pvpBracketSchema.parse,
    );
  }

  private async fetch<T>(region: Region, path: string, parse: (input: unknown) => T) {
    try {
      return parse(await this.http.get(region, path, { namespace: 'profile' }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.isNotFound) {
        this.logger.debug(`Not found: ${region}/${path}`);
        return null;
      }
      throw error;
    }
  }
}
