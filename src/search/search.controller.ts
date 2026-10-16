import { Controller, Get, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { suggestionsQuerySchema, type SuggestionsQuery } from './dto/suggestions-query.dto.js';
import { SearchService } from './search.service.js';
import type { SuggestionsResponse } from './search.types.js';

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
  suggestions(
    @Query(new ZodValidationPipe(suggestionsQuerySchema, 'search query')) query: SuggestionsQuery,
  ): Promise<SuggestionsResponse> {
    return this.search.suggestions(query);
  }
}
