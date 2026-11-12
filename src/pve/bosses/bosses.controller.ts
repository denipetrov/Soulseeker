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
import { bossesQuerySchema, type BossesQuery } from './dto/bosses-query.dto.js';
import { BossesService } from './bosses.service.js';
import type { BossesResponse } from './bosses.types.js';

const EXAMPLE: BossesResponse = {
  region: 'world',
  difficulty: 'mythic',
  bosses: [
    {
      bossName: 'Entombed Sentinels',
      bossSlug: 'entombed-sentinels',
      raid: {
        slug: 'the-venomous-abyss',
        name: 'The Venomous Abyss',
        icon: '8039569',
        expansionId: 11,
      },
      bossRankings: [
        {
          rank: 1,
          itemLevelAvg: 320.212,
          attempts: 7,
          firstDefeated: '2026-08-24T00:56:43.000Z',
          guild: {
            id: 1712677,
            name: 'Liquid',
            faction: 'horde',
            logo: 'https://cdn.raiderio.net/images/rwf/the-venomous-abyss/liquid/guildlogo.png',
            realm: 'Illidan',
            realmSlug: 'illidan',
            region: 'us',
          },
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
export class BossesController {
  constructor(private readonly bossesService: BossesService) {}

  /** `GET /pve/bosses?region=eu&raidSlug=current&difficulty=mythic&top=10` */
  @Get('bosses')
  @ApiOperation({
    summary: 'The first guilds to kill each boss of a raid',
    description:
      'Every boss of the raid in its boss order, or one with `bossSlug`, each with its board: ' +
      'the first guilds to kill it, best first. `raidSlug` defaults to `current`: the open ' +
      'raid of the newest expansion with the most bosses. Every boss is answered at one ' +
      'difficulty, the top-level `difficulty`: the one asked for, or the hardest (mythic, ' +
      'heroic, normal) on which any of the bosses has guilds; a boss nobody has killed there ' +
      'has an empty board. A guild ranked for progress without a kill has ' +
      '`firstDefeated` and `attempts` null. Boards are cached for 10 minutes.',
  })
  @ApiZodQuery(bossesQuerySchema)
  @ApiOkResponse({ description: 'The bosses and their boards.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description: 'A raid the catalogue does not hold, or a boss that raid does not have.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  bosses(
    @Query(new ZodValidationPipe(bossesQuerySchema, 'bosses query')) query: BossesQuery,
  ): Promise<BossesResponse> {
    return this.bossesService.bosses(query);
  }
}
