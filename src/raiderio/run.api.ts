import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { RaiderIoApiError } from './http/raiderio-api.error.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import {
  raiderIoRunDetailsSchema,
  type RaiderIoRunDetailsPayload,
} from './schemas/run-details.schema.js';

/** Typed access to Raider.io's Mythic+ run endpoints. */
@Injectable()
export class RaiderIoRunApi {
  private readonly runDetailsPath: string;

  constructor(
    private readonly http: RaiderIoHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.runDetailsPath = config.get('RAIDERIO_PATH_MPLUS_RUN_DETAILS', { infer: true });
  }

  /**
   * One run of one season, or null for a run Raider.io does not know, which it
   * answers with a 400 or a 404. The season must be the run's own: another one
   * answers that season's run of the same id.
   */
  async getRunDetails(
    season: string,
    keystoneRunId: number,
  ): Promise<RaiderIoRunDetailsPayload | null> {
    try {
      return raiderIoRunDetailsSchema.parse(
        await this.http.get(this.runDetailsPath, {
          searchParams: { season, id: String(keystoneRunId) },
        }),
      );
    } catch (error) {
      if (error instanceof RaiderIoApiError && (error.isBadRequest || error.isNotFound)) {
        return null;
      }
      throw error;
    }
  }
}
