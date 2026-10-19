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
import { leaderboardQuerySchema, type LeaderboardQuery } from './dto/leaderboard-query.dto.js';
import { LeaderboardService } from './leaderboard.service.js';
import type { LeaderboardResponse } from './leaderboard.types.js';

const EXAMPLE: LeaderboardResponse = {
  region: 'us',
  seasonId: 42,
  bracket: 'shuffle',
  class: 'warrior',
  spec: 'arms',
  current: true,
  page: 1,
  pageSize: 50,
  total: 5043,
  totalPages: 101,
  cutoff: {
    rating: 2850,
    title: 'Venomous Legend: Midnight Season 2',
    achievementId: 62923,
    factions: null,
  },
  entries: [
    {
      characterId: 241802571,
      characterName: 'Noobwar',
      realmSlug: 'burning-blade',
      bracket: 'shuffle-warrior-arms',
      rating: 3079,
      rank: 1,
      played: 500,
      won: 285,
      lost: 215,
      faction: 'alliance',
      inTitleRange: true,
      class: 'warrior',
      spec: 'arms',
      gender: 'male',
      heroTalents: 'Slayer',
      level: 90,
      profileStatus: 'ok',
      race: 'Gnome',
    },
  ],
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class LeaderboardController {
  constructor(private readonly leaderboards: LeaderboardService) {}

  /**
   * `GET /pvp/leaderboard?region=eu&seasonId=42&bracket=3v3&page=1&pageSize=50`
   *
   * Optional `class` and `spec` (slugs: `mage`, `fire`) for the current
   * season. 404 for a season the region does not have.
   */
  @Get('leaderboard')
  @ApiOperation({
    summary: 'One page of a PvP ladder',
    description:
      'Current season: live ratings, best first, enriched with names, records and profiles ' +
      '(fields may be null until Rankwarden has enriched a character). Archived season: final ' +
      'standings from the archive, without profile fields. `inTitleRange` compares each rating ' +
      "with the season's title cutoff for its own ladder (and faction, where they differ).",
  })
  @ApiZodQuery(leaderboardQuerySchema)
  @ApiOkResponse({ description: 'A page of the ladder.', schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  @ApiNotFoundResponse({ description: 'The region has no such season.' })
  leaderboard(
    @Query(new ZodValidationPipe(leaderboardQuerySchema, 'leaderboard query'))
    query: LeaderboardQuery,
  ): Promise<LeaderboardResponse> {
    return this.leaderboards.leaderboard(query);
  }
}
