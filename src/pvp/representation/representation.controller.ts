import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import {
  representationQuerySchema,
  type RepresentationQuery,
} from './dto/representation-query.dto.js';
import {
  representationHistoryQuerySchema,
  type RepresentationHistoryQuery,
} from './dto/representation-history-query.dto.js';
import { RepresentationService } from './representation.service.js';
import type {
  RepresentationHistoryResponse,
  RepresentationResponse,
} from './representation.types.js';

const HISTORY_EXAMPLE: RepresentationHistoryResponse = {
  region: 'us',
  bracket: 'shuffle',
  rating: 2100,
  from: '2026-09-29',
  to: '2026-10-29',
  days: [
    {
      date: '2026-10-14',
      computedAt: '2026-10-14T10:35:16.180Z',
      total: 9816,
      classified: 9816,
      specs: [
        {
          class: 'priest',
          spec: 'discipline',
          count: 612,
          share: 0.0623,
          heroTalentsClassified: 612,
          heroTalents: [
            { id: 18, name: 'Voidweaver', count: 401, share: 0.6552 },
            { id: 19, name: 'Oracle', count: 211, share: 0.3448 },
          ],
        },
      ],
    },
    {
      date: '2026-10-20',
      computedAt: '2026-10-20T08:41:40.203Z',
      total: 10852,
      classified: 10852,
      specs: [
        {
          class: 'priest',
          spec: 'discipline',
          count: 655,
          share: 0.0604,
          heroTalentsClassified: 655,
          heroTalents: [
            { id: 18, name: 'Voidweaver', count: 420, share: 0.6412 },
            { id: 19, name: 'Oracle', count: 235, share: 0.3588 },
          ],
        },
      ],
    },
  ],
};

const EXAMPLE: RepresentationResponse = {
  region: 'us',
  bracket: '3v3',
  rating: 2100,
  date: '2026-10-20',
  computedAt: '2026-10-20T08:41:40.203Z',
  total: 4209,
  classified: 3747,
  specs: [
    {
      class: 'warrior',
      spec: 'arms',
      count: 248,
      share: 0.0662,
      heroTalentsClassified: 248,
      heroTalents: [
        { id: 60, name: 'Slayer', count: 242, share: 0.9758 },
        { id: 62, name: 'Colossus', count: 6, share: 0.0242 },
      ],
    },
  ],
  earliestDate: '2026-10-14',
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class RepresentationController {
  constructor(private readonly representation: RepresentationService) {}

  /**
   * `GET /pvp/spec-representation?region=eu&bracket=3v3&rating=2100&date=2026-10-20`
   */
  @Get('spec-representation')
  @ApiOperation({
    summary: 'Which specs are played at or above a rating, on one day',
    description:
      'One daily snapshot. `date=latest` answers the newest one stored, and `date` in the ' +
      'response says which day that is. `share` is of `classified`; specs are most played ' +
      'first.',
  })
  @ApiZodQuery(representationQuerySchema)
  @ApiOkResponse({ description: 'The snapshot.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description:
      'No snapshot for that day (today before it is computed, or a day the job missed), ' +
      'or with `latest`, none stored at all.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  specRepresentation(
    @Query(new ZodValidationPipe(representationQuerySchema, 'spec representation query'))
    query: RepresentationQuery,
  ): Promise<RepresentationResponse> {
    return this.representation.snapshot(query);
  }

  /** `GET /pvp/spec-representation/history?region=eu&bracket=shuffle&rating=2100` */
  @Get('spec-representation/history')
  @ApiOperation({
    summary: 'Each spec over the last 31 days, for a graph',
    description:
      'The daily snapshots of the last 31 UTC days, today included, oldest first. Only days ' +
      'with a snapshot are listed — `days[0].date` is where the data begins, and a gap is a ' +
      'day Rankwarden did not write. `from` and `to` are the window, for the axis. Each ' +
      "spec is as the day endpoint gives it, with its hero talents' split.",
  })
  @ApiZodQuery(representationHistoryQuerySchema)
  @ApiOkResponse({ description: 'The stored days.', schema: { example: HISTORY_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'No snapshot at all in the 31-day window.' })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  specRepresentationHistory(
    @Query(
      new ZodValidationPipe(representationHistoryQuerySchema, 'spec representation history query'),
    )
    query: RepresentationHistoryQuery,
  ): Promise<RepresentationHistoryResponse> {
    return this.representation.history(query);
  }
}
