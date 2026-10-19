import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../docs/swagger.js';
import { ApiZodQuery } from '../docs/zod-openapi.js';
import { suggestionsQuerySchema, type SuggestionsQuery } from './dto/suggestions-query.dto.js';
import { SearchService } from './search.service.js';
import type { SuggestionsResponse } from './search.types.js';

const EXAMPLE: SuggestionsResponse = {
  type: 'pve',
  query: 'bad',
  characters: [
    {
      characterName: 'Badbunny',
      region: 'us',
      realmSlug: 'illidan',
      realmName: 'Illidan',
      className: 'Shaman',
      specName: 'Elemental',
      heroTalents: null,
      raceName: 'Dwarf',
      faction: 'alliance',
    },
  ],
  guilds: [{ name: 'Bad Call', region: 'eu', realmSlug: 'blackhand', realmName: 'Blackhand' }],
};

@ApiTags('search')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * `GET /search/suggestions?type=pvp|pve&q=<letters>`
   *
   * PvP: up to 100 characters from the current PvP seasons. PvE: up to 100
   * Mythic+ characters from the current Mythic+ seasons, and up to 100 guilds.
   * Matching ignores case and accents: `biba` finds `Bìbà` and `Biba`.
   */
  @Get('suggestions')
  @ApiOperation({
    summary: 'Name suggestions as the visitor types',
    description:
      'Up to 100 characters (and, for PvE, up to 100 guilds) whose name starts with `q`, ' +
      'ignoring case and accents. Current seasons only. `guilds` is empty for PvP; ' +
      '`heroTalents` is always null for Mythic+ characters.',
  })
  @ApiZodQuery(suggestionsQuerySchema)
  @ApiOkResponse({ description: 'Matching names, in name order.', schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Unknown type, or a query shorter than 2 letters.' })
  suggestions(
    @Query(new ZodValidationPipe(suggestionsQuerySchema, 'search query')) query: SuggestionsQuery,
  ): Promise<SuggestionsResponse> {
    return this.search.suggestions(query);
  }
}
