import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RaidDifficulty } from '@denipetrov/spirit-link/constants';

import type { Env } from '../config/env.schema.js';
import { RaiderIoApiError } from './http/raiderio-api.error.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import type { RaiderIoRegion } from './raiderio.constants.js';
import {
  raiderIoBossKillSchema,
  raiderIoGuildSchema,
  type RaiderIoBossKillPayload,
  type RaiderIoGuildPayload,
} from './schemas/guild-profile.schema.js';

/**
 * Typed access to Raider.io's guild endpoints.
 *
 * Both resolve to null for a guild Raider.io does not know, which it answers
 * with a 400 ("Could not find requested guild").
 */
@Injectable()
export class RaiderIoGuildApi {
  private readonly profilePath: string;
  private readonly bossKillPath: string;

  constructor(
    private readonly http: RaiderIoHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.profilePath = config.get('RAIDERIO_PATH_GUILD_PROFILE', { infer: true });
    this.bossKillPath = config.get('RAIDERIO_PATH_GUILD_BOSS_KILL', { infer: true });
  }

  getProfile(
    region: RaiderIoRegion,
    realmSlug: string,
    guildName: string,
    fields: readonly string[],
  ): Promise<RaiderIoGuildPayload | null> {
    return this.fetch(
      this.profilePath,
      region,
      { region, realm: realmSlug, name: guildName, fields: fields.join(',') },
      raiderIoGuildSchema.parse,
    );
  }

  getBossKill(
    region: RaiderIoRegion,
    realmSlug: string,
    guildName: string,
    raid: string,
    boss: string,
    difficulty: RaidDifficulty,
  ): Promise<RaiderIoBossKillPayload | null> {
    return this.fetch(
      this.bossKillPath,
      region,
      { region, realm: realmSlug, guild: guildName, raid, boss, difficulty },
      raiderIoBossKillSchema.parse,
    );
  }

  private async fetch<T>(
    path: string,
    region: RaiderIoRegion,
    searchParams: Record<string, string>,
    parse: (input: unknown) => T,
  ): Promise<T | null> {
    try {
      return parse(await this.http.get(path, { region, searchParams }));
    } catch (error) {
      if (error instanceof RaiderIoApiError && (error.isBadRequest || error.isNotFound)) {
        return null;
      }
      throw error;
    }
  }
}
