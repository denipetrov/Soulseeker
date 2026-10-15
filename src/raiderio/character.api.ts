import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { RaiderIoApiError } from './http/raiderio-api.error.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import type { RaiderIoRegion } from './raiderio.constants.js';
import {
  raiderIoCharacterSchema,
  type RaiderIoCharacterPayload,
} from './schemas/character-profile.schema.js';

/** The profile fields asked for unless a caller says otherwise. */
export const DEFAULT_CHARACTER_FIELDS = [
  'mythic_plus_scores_by_season:current',
  'mythic_plus_best_runs',
] as const;

/** Typed access to Raider.io's character profile. */
@Injectable()
export class RaiderIoCharacterApi {
  private readonly profilePath: string;

  constructor(
    private readonly http: RaiderIoHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.profilePath = config.get('RAIDERIO_PATH_CHARACTER_PROFILE', { infer: true });
  }

  /**
   * Resolves to null for a character Raider.io does not know, which it
   * answers with a 400 rather than a 404.
   */
  async getProfile(
    region: RaiderIoRegion,
    realmSlug: string,
    characterName: string,
    fields: readonly string[] = DEFAULT_CHARACTER_FIELDS,
  ): Promise<RaiderIoCharacterPayload | null> {
    try {
      const payload = await this.http.get(this.profilePath, {
        region,
        searchParams: { region, realm: realmSlug, name: characterName, fields: fields.join(',') },
      });

      return raiderIoCharacterSchema.parse(payload);
    } catch (error) {
      if (error instanceof RaiderIoApiError && (error.isBadRequest || error.isNotFound)) {
        return null;
      }
      throw error;
    }
  }
}
