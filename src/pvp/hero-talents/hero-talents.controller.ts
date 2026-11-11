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
import { heroTalentsQuerySchema, type HeroTalentsQuery } from './dto/hero-talents-query.dto.js';
import { HeroTalentsService } from './hero-talents.service.js';
import type { HeroTalentsResponse } from './hero-talents.types.js';

const EXAMPLE: HeroTalentsResponse = {
  region: 'world',
  bracket: '3v3',
  seasonId: 42,
  seasonName: 'Player vs. Player (Midnight Season 2)',
  top: 50,
  computedAt: '2026-11-11T10:05:41.318Z',
  classes: [
    {
      class: 'warrior',
      specs: [
        {
          spec: 'arms',
          characters: 50,
          covered: 46,
          minRating: 2611,
          maxRating: 3197,
          heroTalents: [
            { id: 60, name: 'Slayer', count: 41, share: 0.8913 },
            { id: 62, name: 'Colossus', count: 5, share: 0.1087 },
          ],
        },
      ],
    },
  ],
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class HeroTalentsController {
  constructor(private readonly heroTalentsService: HeroTalentsService) {}

  /** `GET /pvp/hero-talents?region=eu&bracket=3v3&top=50` */
  @Get('hero-talents')
  @ApiOperation({
    summary: 'Which hero talent trees each spec’s best players use',
    description:
      'For every spec, grouped by class, its top `top` characters (50 by default) on the ' +
      "current season's ladder, and how many play each hero talent tree. `characters` is " +
      'how many were read; `covered` how many have a known tree — Rankwarden fills them in ' +
      'over time — and each tree’s `share` is of `covered`. `minRating` and `maxRating` ' +
      'span the characters read. On Shuffle and Blitz the tree is that spec’s own loadout; ' +
      'on 2v2, 3v3 and RBG the active spec’s. `region=world` reads every region together. ' +
      'Cached for 15 minutes.',
  })
  @ApiZodQuery(heroTalentsQuerySchema)
  @ApiOkResponse({ description: 'Every class and spec.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({ description: 'No current season recorded for the region.' })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  heroTalents(
    @Query(new ZodValidationPipe(heroTalentsQuerySchema, 'hero talents query'))
    query: HeroTalentsQuery,
  ): Promise<HeroTalentsResponse> {
    return this.heroTalentsService.heroTalents(query);
  }
}
