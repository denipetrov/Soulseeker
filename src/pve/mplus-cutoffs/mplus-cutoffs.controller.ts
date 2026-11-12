import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import type { RaiderIoCutoffAnalysisPayload } from '../../raiderio/schemas/cutoff-analysis.schema.js';
import { mplusCutoffsQuerySchema, type MplusCutoffsQuery } from './dto/mplus-cutoffs-query.dto.js';
import { MplusCutoffsService } from './mplus-cutoffs.service.js';

const EXAMPLE: RaiderIoCutoffAnalysisPayload = {
  season: 'season-mn-2',
  region: 'us',
  snapshotDate: '2026-11-11',
  updatedAt: '2026-11-11T10:14:02.691Z',
  seasonStartDate: '2026-08-18',
  populations: [
    {
      key: 'overall',
      label: 'Overall',
      faction: 'all',
      population: 728980,
      titleContext: { cutoffScore: 4057.65, tailSize: 729, topFraction: 0.001 },
      percentiles: [
        { percentile: 0.1, cutoffScore: 4057.65, tailSize: 729, forecastState: 'ready' },
        { percentile: 1, cutoffScore: 3789.99, tailSize: 7290, forecastState: 'ready' },
      ],
    },
  ],
  history: [
    {
      date: '2026-08-18',
      population: 83603,
      cutoffs: [
        { percentile: 0.1, score: 2671.6 },
        { percentile: 1, score: 2442.1 },
      ],
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class MplusCutoffsController {
  constructor(private readonly cutoffsService: MplusCutoffsService) {}

  /** `GET /pve/mplus-cutoffs?region=us&season=current` */
  @Get('mplus-cutoffs')
  @ApiOperation({
    summary: 'A Mythic+ season’s percentile cutoffs, day by day, from Raider.io',
    description:
      'Raider.io’s cutoff analysis as it comes: the current snapshot per population ' +
      '(overall, Horde, Alliance) with the title cutoff and the 0.1 / 1 / 5 / 10 / 25 / 40 % ' +
      'scores, and `history`, one entry per day since the season started. `region` ' +
      'defaults to `world`, `season` to `current`. Cached for an hour.',
  })
  @ApiZodQuery(mplusCutoffsQuerySchema)
  @ApiOkResponse({ description: 'The cutoff analysis.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description: 'A season the catalogue does not know, or one Raider.io has no analysis for.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  @ApiServiceUnavailableResponse({ description: 'The Raider.io budget is spent; see Retry-After.' })
  @ApiBadGatewayResponse({ description: 'Raider.io could not be reached.' })
  cutoffs(
    @Query(new ZodValidationPipe(mplusCutoffsQuerySchema, 'Mythic+ cutoffs query'))
    query: MplusCutoffsQuery,
  ): Promise<RaiderIoCutoffAnalysisPayload> {
    return this.cutoffsService.cutoffs(query);
  }
}
