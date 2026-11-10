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
import { pveTierListQuerySchema, type PveTierListQuery } from './dto/pve-tier-list-query.dto.js';
import { PveTierListService } from './pve-tier-list.service.js';
import type { PveTierListResponse } from './pve-tier-list.types.js';

const EXAMPLE: PveTierListResponse = {
  region: 'world',
  season: 'season-mn-2',
  seasonName: 'MN Season 2',
  computedAt: '2026-11-10T10:05:41.318Z',
  minScore: 2000,
  topRows: 5000,
  topClassified: 5000,
  classified: 95885,
  specs: [
    {
      class: 'paladin',
      spec: 'holy',
      tier: 'S',
      score: 96.1,
      topDensity: { top250: 61, top500: 118, top1000: 230, top2500: 571, top5000: 1104, score: 45 },
      representation: { count: 9876, share: 0.103, score: 35 },
      averageRating: { value: 3712.4, adjusted: 3703.7, score: 16.1 },
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class PveTierListController {
  constructor(private readonly tierLists: PveTierListService) {}

  /** `GET /pve/tier-list?region=eu` */
  @Get('tier-list')
  @ApiOperation({
    summary: 'Each Mythic+ spec ranked S to D, for a tier list',
    description:
      'The current season, on `world` (the default) or one region, by the PvP tier list’s ' +
      'rules, in the same shape: top tier density, 45 — the spec’s characters in the top ' +
      '250 … 5,000 by score, weighted 30/25/20/15/10 %; representation, 35, and average ' +
      'score, 20 (`averageRating`), both over fully covered characters at or above 2000 ' +
      '(Keystone Master), split by order, the average weighed by count. Tiers S/A/B/C/D at ' +
      '10/25/30/25/10 %, each line moved up to 2 specs to the widest score drop. A ' +
      'character counts for its profile spec. Cached for an hour.',
  })
  @ApiZodQuery(pveTierListQuerySchema)
  @ApiOkResponse({ description: 'The tier list, best first.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description: 'No current Mythic+ season, or no character with a known spec yet.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  tierList(
    @Query(new ZodValidationPipe(pveTierListQuerySchema, 'PvE tier list query'))
    query: PveTierListQuery,
  ): Promise<PveTierListResponse> {
    return this.tierLists.tierList(query);
  }
}
