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
import { mplusRunsQuerySchema, type MplusRunsQuery } from './dto/mplus-runs-query.dto.js';
import { MplusRunsService } from './mplus-runs.service.js';
import type { MplusRunsResponse } from './mplus-runs.types.js';

const EXAMPLE: MplusRunsResponse = {
  region: 'world',
  season: 'season-mn-2',
  current: true,
  dungeon: 'murder-row',
  page: 1,
  pageSize: 50,
  total: 100100,
  totalPages: 2003,
  runs: [
    {
      rank: 1,
      keystoneRunId: 19324786,
      region: 'us',
      score: 519,
      dungeon: { id: 16091, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
      mythicLevel: 22,
      clearTimeMs: 1824300,
      keystoneTimeMs: 2040999,
      timeRemainingMs: 216699,
      numChests: 1,
      completedAt: '2026-10-09T00:24:13.000Z',
      affixIds: [9, 10, 147],
      faction: 'alliance',
      roster: [
        {
          rioCharacterId: 301727023,
          characterName: 'Happyfulx',
          realmSlug: 'illidan',
          realmId: 57,
          region: 'us',
          classId: 8,
          className: 'Mage',
          specId: 62,
          specName: 'Arcane',
          role: 'dps',
          faction: 'alliance',
          anonymized: false,
        },
      ],
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class MplusRunsController {
  constructor(private readonly runsService: MplusRunsService) {}

  /** `GET /pve/mplus-runs?region=eu&dungeon=murder-row&page=2` */
  @Get('mplus-runs')
  @ApiOperation({
    summary: 'The Mythic+ run board, a page at a time',
    description:
      'Timed runs by `score`, best first, on `world` (the default) or one region, for ' +
      'every dungeon or one (`dungeon`, a slug of the season). `season` defaults to ' +
      '`current`; a past season is read from the archive, and `current` in the response ' +
      'says which. Each run comes as stored, with its full roster; affixes by id, as ' +
      '`GET /pve/mplus-seasons` lists them. `rank` is the place on this board. Paging stops ' +
      'at row 200,000, and `totalPages` with it. Cached for 5 minutes.',
  })
  @ApiZodQuery(mplusRunsQuerySchema)
  @ApiOkResponse({ description: 'One page of runs.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description:
      'A season the catalogue does not know, no current season recorded, or a dungeon the ' +
      'season does not run.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  runs(
    @Query(new ZodValidationPipe(mplusRunsQuerySchema, 'Mythic+ runs query'))
    query: MplusRunsQuery,
  ): Promise<MplusRunsResponse> {
    return this.runsService.runs(query);
  }
}
