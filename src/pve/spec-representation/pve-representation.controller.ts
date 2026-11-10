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
  pveRepresentationQuerySchema,
  type PveRepresentationQuery,
} from './dto/pve-representation-query.dto.js';
import { PveRepresentationService } from './pve-representation.service.js';
import type { PveRepresentationResponse } from './pve-representation.types.js';

const EXAMPLE: PveRepresentationResponse = {
  region: 'world',
  season: 'season-mn-2',
  dungeon: 'all',
  source: 'live',
  computedAt: '2026-11-05T12:41:31.564Z',
  runs: 800781,
  slots: 4003905,
  classified: 4003905,
  roles: { tank: 800781, healer: 800781, dps: 2402343 },
  specs: [
    {
      class: 'deathknight',
      spec: 'blood',
      classId: 6,
      className: 'Death Knight',
      specId: 250,
      specName: 'Blood',
      role: 'tank',
      count: 412035,
      percent: 10.29,
      rolePercent: 51.45,
    },
  ],
  seasons: ['season-mn-2', 'season-mn-1', 'season-tww-3'],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class PveRepresentationController {
  constructor(private readonly representation: PveRepresentationService) {}

  /** `GET /pve/spec-representation?region=eu&dungeonSlug=murder-row&getSeasons=true` */
  @Get('spec-representation')
  @ApiOperation({
    summary: 'Which specs a Mythic+ season’s best runs were played with',
    description:
      'Counted by roster slot over the runs Rankwarden stores (the top of each region’s ' +
      'board): `world` (the default) or one region, every dungeon (`dungeonSlug=all`, the ' +
      'default) or one. `percent` is a share of every classified slot, `rolePercent` of the ' +
      'slots of the spec’s own role — the figure to compare specs by — both 0–100; specs ' +
      'come most played first. One snapshot per season, not per day: `season` (default ' +
      '`current`) picks it, `source` says whether it still moves (`live`) or is final ' +
      '(`archive`), and `getSeasons=true` lists the seasons that have one.',
  })
  @ApiZodQuery(pveRepresentationQuerySchema)
  @ApiOkResponse({ description: 'The snapshot.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description:
      'No snapshot for that region, dungeon and season; a season the catalogue does not ' +
      'know; or a dungeon the season does not run.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  specRepresentation(
    @Query(new ZodValidationPipe(pveRepresentationQuerySchema, 'PvE spec representation query'))
    query: PveRepresentationQuery,
  ): Promise<PveRepresentationResponse> {
    return this.representation.representation(query);
  }
}
