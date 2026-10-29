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
import { tierListQuerySchema, type TierListQuery } from './dto/tier-list-query.dto.js';
import { TierListService } from './tier-list.service.js';
import type { TierListResponse } from './tier-list.types.js';

const EXAMPLE: TierListResponse = {
  region: 'eu',
  bracket: 'shuffle',
  seasonId: 42,
  seasonName: 'Player vs. Player (Midnight Season 2)',
  computedAt: '2026-10-29T12:05:41.318Z',
  minRating: 1500,
  topRows: 5000,
  topClassified: 5000,
  classified: 63369,
  specs: [
    {
      class: 'priest',
      spec: 'discipline',
      tier: 'S',
      score: 93.41,
      topDensity: {
        top250: 21,
        top500: 44,
        top1000: 93,
        top2500: 231,
        top5000: 452,
        score: 38.41,
      },
      representation: { count: 5003, share: 0.079, score: 35 },
      averageRating: { value: 2003.3, adjusted: 1998.3, score: 20 },
    },
  ],
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class TierListController {
  constructor(private readonly tierLists: TierListService) {}

  /** `GET /pvp/tier-list?region=eu&bracket=shuffle` */
  @Get('tier-list')
  @ApiOperation({
    summary: 'Each spec of a ladder ranked S to D, for a tier list',
    description:
      "The current season's ladder. A spec's `score` (0–100) adds up three factors: " +
      'top tier density, 45 — its rows in the top 250, 500, 1,000, 2,500 and 5,000, weighted ' +
      '30/25/20/15/10 % and each against the spec that leads that band; representation, 35, ' +
      'and average rating, 20 — both of rows at or above 1500, split by order from the ' +
      'highest spec to the lowest. The average is ranked as `adjusted`: taken with 50 more ' +
      'players at 1500, so a spec of a few players does not outrank one of thousands. ' +
      'Every spec is listed, one nobody plays last with 0. Ordered by score, the specs are ' +
      'cut into S (top 10 %), A (next 25 %), B (30 %), C (25 %) and D (last 10 %) — each ' +
      'line then moved up to 2 specs either way, to the widest score drop near it, so specs ' +
      'that score close together share a tier. Cached for an hour.',
  })
  @ApiZodQuery(tierListQuerySchema)
  @ApiOkResponse({ description: 'The tier list, best first.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description:
      'No current season for the region, or no row of the ladder has a known spec yet ' +
      '(2v2, 3v3 and RBG before Rankwarden enriches them).',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  tierList(
    @Query(new ZodValidationPipe(tierListQuerySchema, 'tier list query')) query: TierListQuery,
  ): Promise<TierListResponse> {
    return this.tierLists.tierList(query);
  }
}
