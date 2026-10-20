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
import { RepresentationService } from './representation.service.js';
import type { RepresentationResponse } from './representation.types.js';

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
}
