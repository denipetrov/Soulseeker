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
import type { PvpSeasonsResponse } from './pvp-season.types.js';
import { PvpSeasonsService } from './pvp-seasons.service.js';

const gladiator = (rating: number) => ({
  rating,
  title: 'Gladiator: Midnight Season 2',
  achievementId: 62910,
  factions: null,
});

const hero = (rating: number) => ({
  rating,
  title: null,
  achievementId: null,
  factions: {
    alliance: { rating, title: 'Hero of the Alliance: Midnight Season 2', achievementId: 62911 },
    horde: { rating, title: 'Hero of the Horde: Midnight Season 2', achievementId: 62912 },
  },
});

const EXAMPLE: PvpSeasonsResponse = {
  seasons: [
    {
      seasonId: 42,
      name: 'Player vs. Player (Midnight Season 2)',
      current: true,
      regions: {
        us: {
          startsAt: '2026-08-18T15:00:00.000Z',
          endsAt: null,
          current: true,
          final: false,
          rewardsFetchedAt: '2026-11-27T09:46:33.202Z',
          cutoffs: { '3v3': gladiator(2858), rbg: hero(2412) },
        },
      },
    },
    {
      seasonId: 41,
      name: 'Player vs. Player (Midnight Season 1)',
      current: false,
      regions: {
        us: {
          startsAt: '2026-03-17T15:00:00.000Z',
          endsAt: '2026-08-11T05:00:00.000Z',
          current: false,
          final: true,
          rewardsFetchedAt: '2026-08-12T10:02:11.000Z',
          cutoffs: { '3v3': gladiator(3154), rbg: hero(2530) },
        },
      },
    },
  ],
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class PvpSeasonsController {
  constructor(private readonly pvpSeasons: PvpSeasonsService) {}

  /** `GET /pvp/seasons` */
  @Get('seasons')
  @ApiOperation({
    summary: 'Every PvP season, with its dates and 3v3 and RBG title cutoffs per region',
    description:
      'Seasons newest first, by Blizzard season id (shared by every region). Per region: its ' +
      'dates (`endsAt` null while it runs), whether it is the live season (`current`), whether ' +
      'its cutoffs are final (archived), and the 3v3 and RBG title cutoffs. 2v2 awards no title; ' +
      'the per-spec Solo Shuffle and Blitz cutoffs are on `GET /pvp/cutoffs`. `name` is null for ' +
      'the seasons Blizzard left unnamed. Cached for an hour.',
  })
  @ApiOkResponse({ description: 'The seasons.', schema: { example: EXAMPLE } })
  seasons(): Promise<PvpSeasonsResponse> {
    return this.pvpSeasons.list();
  }
}
