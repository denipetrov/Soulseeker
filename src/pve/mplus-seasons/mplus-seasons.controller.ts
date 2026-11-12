import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { BEARER_AUTH } from '../../docs/swagger.js';
import { MplusSeasonsService } from './mplus-seasons.service.js';
import type { MplusSeasonsResponse } from './mplus-seasons.types.js';

const band = (minScore: number, populationCount: number) => ({
  quantile: null,
  minScore,
  populationCount,
  populationFraction: null,
  totalPopulation: 722549,
});

const EXAMPLE: MplusSeasonsResponse = {
  seasons: [
    {
      slug: 'season-mn-2',
      name: 'MN Season 2',
      shortName: 'MN2',
      expansionId: 11,
      blizzardSeasonId: 18,
      starts: { us: '2026-08-18T15:00:00.000Z', eu: '2026-08-19T04:00:00.000Z' },
      ends: { us: null, eu: null },
      dungeons: [
        {
          id: 7805,
          slug: 'black-rook-hold',
          name: 'Black Rook Hold',
          shortName: 'BRH',
          challengeModeId: 199,
          keystoneTimerSeconds: 2160,
          iconUrl:
            'https://cdn.raiderio.net/images/wow/icons/large/achievement_dungeon_blackrookhold.jpg',
          backgroundImageUrl:
            'https://cdn.raiderio.net/images/dungeons/expansion6/base/black-rook-hold.jpg',
          expansionIds: [6, 9],
        },
      ],
      cutoffs: {
        us: {
          status: 'ok',
          updatedAt: '2026-11-05T10:00:47.000Z',
          keystones: {
            keystoneMaster: {
              score: 2000,
              alliance: null,
              horde: null,
              all: band(1999.84, 419801),
            },
          },
          quantiles: {
            p999: { score: null, alliance: null, horde: null, all: band(4044.34, 723) },
          },
        },
      },
    },
  ],
  affixes: [
    {
      id: 10,
      name: 'Fortified',
      slug: 'fortified',
      description: 'Non-boss enemies have 20% more health and inflict up to 20% increased damage.',
      icon: 'ability_toughness',
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class MplusSeasonsController {
  constructor(private readonly mplusSeasons: MplusSeasonsService) {}

  /** `GET /pve/mplus-seasons` */
  @Get('mplus-seasons')
  @ApiOperation({
    summary: 'Every Mythic+ season, with its dungeons and cutoffs, and every affix',
    description:
      'Seasons newest first, each with its regional dates (`ends` null while it runs), its ' +
      'dungeons in full (name, timer, icon and background art) and its title and top-percent ' +
      'cutoffs per region, empty before The War Within season 3. `affixes` is every affix, by ' +
      'id; affixes are not tied to a season. Cached for an hour.',
  })
  @ApiOkResponse({ description: 'The seasons and affixes.', schema: { example: EXAMPLE } })
  seasons(): Promise<MplusSeasonsResponse> {
    return this.mplusSeasons.seasons();
  }
}
