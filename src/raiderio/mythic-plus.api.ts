import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { RaiderIoApiError } from './http/raiderio-api.error.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import {
  raiderIoCutoffAnalysisSchema,
  type RaiderIoCutoffAnalysisPayload,
} from './schemas/cutoff-analysis.schema.js';
import {
  raiderIoRunDetailsSchema,
  type RaiderIoRunDetailsPayload,
} from './schemas/run-details.schema.js';

/**
 * Typed access to Raider.io's Mythic+ endpoints. Each resolves to null for
 * what Raider.io does not have, which it answers with a 400 or a 404.
 */
@Injectable()
export class RaiderIoMythicPlusApi {
  private readonly runDetailsPath: string;
  private readonly cutoffAnalysisPath: string;

  constructor(
    private readonly http: RaiderIoHttpService,
    config: ConfigService<Env, true>,
  ) {
    this.runDetailsPath = config.get('RAIDERIO_PATH_MPLUS_RUN_DETAILS', { infer: true });
    this.cutoffAnalysisPath = config.get('RAIDERIO_PATH_MPLUS_CUTOFF_ANALYSIS', { infer: true });
  }

  /**
   * One run of one season. The season must be the run's own: another one
   * answers that season's run of the same id.
   */
  getRunDetails(season: string, keystoneRunId: number): Promise<RaiderIoRunDetailsPayload | null> {
    return this.fetch(
      this.runDetailsPath,
      { season, id: String(keystoneRunId) },
      raiderIoRunDetailsSchema.parse,
    );
  }

  /** How a season's percentile cutoffs stand in a region, or `world`, day by day. */
  getCutoffAnalysis(season: string, region: string): Promise<RaiderIoCutoffAnalysisPayload | null> {
    return this.fetch(
      this.cutoffAnalysisPath,
      { season, region, format: 'json' },
      raiderIoCutoffAnalysisSchema.parse,
      region,
    );
  }

  private async fetch<T>(
    path: string,
    searchParams: Record<string, string>,
    parse: (input: unknown) => T,
    region?: string,
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
