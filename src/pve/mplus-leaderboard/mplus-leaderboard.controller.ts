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
  mplusLeaderboardQuerySchema,
  type MplusLeaderboardQuery,
} from './dto/mplus-leaderboard-query.dto.js';
import { MplusLeaderboardService } from './mplus-leaderboard.service.js';
import type { MplusLeaderboardResponse } from './mplus-leaderboard.types.js';

const EXAMPLE: MplusLeaderboardResponse = {
  region: 'world',
  season: 'season-mn-2',
  current: true,
  class: 'shaman',
  spec: 'elemental',
  role: null,
  page: 1,
  pageSize: 50,
  total: 4411,
  totalPages: 89,
  entries: [
    {
      rank: 1,
      characterName: 'Bondd',
      realmName: 'Illidan',
      realmSlug: 'illidan',
      region: 'us',
      faction: 'alliance',
      mythicScore: 4136.1,
      isFullyCovered: true,
      profile: {
        classId: 7,
        className: 'Shaman',
        specId: 262,
        specName: 'Elemental',
        raceId: 3,
        raceName: 'Dwarf',
        level: 90,
        role: 'dps',
      },
      dungeonRuns: [
        {
          dungeon: { id: 16091, name: 'Murder Row', slug: 'murder-row', shortName: 'MR' },
          keystoneRunId: 19324786,
          mythicLevel: 22,
          score: 519,
          clearTimeMs: 1824300,
          timeRemainingMs: 216699,
          numChests: 1,
          completedAt: '2026-10-09T00:24:13.000Z',
          specId: 262,
          role: 'dps',
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
export class MplusLeaderboardController {
  constructor(private readonly leaderboards: MplusLeaderboardService) {}

  /** `GET /pve/mplus-leaderboard?region=eu&class=mage&spec=arcane&page=2` */
  @Get('mplus-leaderboard')
  @ApiOperation({
    summary: 'The Mythic+ character leaderboard, a page at a time',
    description:
      'Characters by `mythicScore`, best first, on `world` (the default) or one region. ' +
      '`season` defaults to `current`; a past season is read from the archive, and ' +
      '`current` in the response says which. Filter by `class`, `class` + `spec`, `role`, ' +
      'or `class` + `role`; `spec` and `role` do not go together. `rank` is the place on ' +
      'the filtered board. Every character is listed: `isFullyCovered` false means their ' +
      'runs miss some dungeon of the season, so `mythicScore` is partial. Dungeons come as ' +
      'stored, by id. Pages are cached for 5 minutes.',
  })
  @ApiZodQuery(mplusLeaderboardQuerySchema)
  @ApiOkResponse({ description: 'One page of the board.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description: 'A season the catalogue does not know, or no current season recorded.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  leaderboard(
    @Query(new ZodValidationPipe(mplusLeaderboardQuerySchema, 'Mythic+ leaderboard query'))
    query: MplusLeaderboardQuery,
  ): Promise<MplusLeaderboardResponse> {
    return this.leaderboards.leaderboard(query);
  }
}
