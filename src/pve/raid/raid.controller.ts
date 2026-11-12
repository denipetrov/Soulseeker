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
import { raidQuerySchema, type RaidQuery } from './dto/raid-query.dto.js';
import { RaidService } from './raid.service.js';
import type { RaidResponse } from './raid.types.js';

const EXAMPLE: RaidResponse = {
  region: 'world',
  difficulty: 'mythic',
  raid: {
    slug: 'the-venomous-abyss',
    name: 'The Venomous Abyss',
    icon: '8039569',
    encounters: [
      { id: 197163, slug: 'nekzali-the-soulcoiler', name: "Nek'zali the Soulcoiler" },
      { id: 197164, slug: 'entombed-sentinels', name: 'Entombed Sentinels' },
    ],
  },
  updatedAt: '2026-11-03T10:48:02.789Z',
  guilds: [
    {
      rank: 1,
      regionRank: 1,
      guild: {
        id: 1712677,
        name: 'Liquid',
        faction: 'horde',
        logo: 'https://cdn.raiderio.net/images/rwf/the-venomous-abyss/liquid/guildlogo.png',
        realm: 'Illidan',
        realmSlug: 'illidan',
        region: 'us',
      },
      encountersPulled: [
        {
          encounterId: 197163,
          slug: 'nekzali-the-soulcoiler',
          numPulls: 1,
          pullStartedAt: '2026-08-23T23:13:50.000Z',
          bestPercent: 0,
          isDefeated: true,
        },
      ],
      encountersDefeated: [
        {
          encounterId: 197163,
          slug: 'nekzali-the-soulcoiler',
          firstDefeated: '2026-08-23T23:21:30.000Z',
          lastDefeated: '2026-10-30T00:10:30.000Z',
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
export class RaidController {
  constructor(private readonly raids: RaidService) {}

  /** `GET /pve/raid?raidSlug=the-venomous-abyss&region=eu&difficulty=heroic` */
  @Get('raid')
  @ApiOperation({
    summary: 'One raid and its top hundred guilds',
    description:
      'The raid (name, icon, bosses in order) and its board for a region — `world` by ' +
      'default — at one difficulty, `mythic` by default: the top hundred guilds, best first, ' +
      'each with its guild and every boss it has pulled and killed, as Rankwarden stores ' +
      'them. `guilds` is empty, and `updatedAt` null, for a board Rankwarden has not read. ' +
      'Cached for 10 minutes.',
  })
  @ApiZodQuery(raidQuerySchema)
  @ApiOkResponse({ description: 'The raid and its board.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({ description: 'A raid the catalogue does not hold.' })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  raid(
    @Query(new ZodValidationPipe(raidQuerySchema, 'raid query')) query: RaidQuery,
  ): Promise<RaidResponse> {
    return this.raids.raid(query);
  }
}
