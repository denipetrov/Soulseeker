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
import { cutoffsQuerySchema, type CutoffsQuery } from './dto/cutoffs-query.dto.js';
import { CutoffsService } from './cutoffs.service.js';
import type { CutoffCharactersResponse, CutoffsResponse } from './cutoffs.types.js';

const CHARACTERS_EXAMPLE: CutoffCharactersResponse = {
  region: 'us',
  bracket: 'shuffle',
  class: 'warrior',
  spec: 'arms',
  seasonId: 42,
  seasonName: 'Player vs. Player (Midnight Season 2)',
  final: false,
  rewardsFetchedAt: '2026-10-19T09:46:33.202Z',
  cutoff: {
    bracket: 'shuffle-warrior-arms',
    rating: 2850,
    title: 'Venomous Legend: Midnight Season 2',
    achievementId: 62923,
    factions: null,
  },
  total: 1,
  characters: [
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

const EXAMPLE: CutoffsResponse = {
  region: 'eu',
  bracket: 'shuffle',
  seasonId: 42,
  seasonName: 'Player vs. Player (Midnight Season 2)',
  final: false,
  rewardsFetchedAt: '2026-10-19T09:46:33.202Z',
  cutoff: null,
  total: 635,
  specs: [
    {
      class: 'evoker',
      spec: 'preservation',
      count: 21,
      cutoff: {
        bracket: 'shuffle-evoker-preservation',
        rating: 2873,
        title: 'Venomous Legend: Midnight Season 2',
        achievementId: 62923,
        factions: null,
      },
    },
  ],
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class CutoffsController {
  constructor(private readonly cutoffs: CutoffsService) {}

  /** `GET /pvp/cutoffs?region=eu&bracket=shuffle` */
  @Get('cutoffs')
  @ApiOperation({
    summary: "The current season's title cutoffs, and how many of each spec reach them",
    description:
      '3v3 and RBG: one cutoff (`cutoff`), counts grouped by active spec — null class and ' +
      'spec for characters not enriched yet. Shuffle and Blitz: a cutoff per spec ladder, ' +
      'given on each spec entry with its title. "Reach" is rating at or above the cutoff. ' +
      'With `class` and `spec`: instead of counts, the characters of that spec who reach ' +
      'it, best first, in the leaderboard entry shape.',
  })
  @ApiZodQuery(cutoffsQuerySchema)
  @ApiOkResponse({
    description: 'Cutoffs and counts per spec; with `class` and `spec`, the qualifying characters.',
    content: {
      'application/json': {
        examples: {
          counts: { summary: 'Counts per spec', value: EXAMPLE },
          characters: { summary: 'With class and spec', value: CHARACTERS_EXAMPLE },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'An unknown region, a bracket without titles (2v2), or class without spec or spec ' +
      'without class.',
  })
  @ApiNotFoundResponse({
    description:
      'No current season for the region, no cutoffs recorded for it yet, or none for the ' +
      'class and spec given.',
  })
  list(
    @Query(new ZodValidationPipe(cutoffsQuerySchema, 'cutoffs query')) query: CutoffsQuery,
  ): Promise<CutoffsResponse | CutoffCharactersResponse> {
    return this.cutoffs.cutoffs(query);
  }
}
