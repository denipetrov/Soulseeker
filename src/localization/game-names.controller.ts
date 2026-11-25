import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../docs/swagger.js';
import { ApiZodQuery } from '../docs/zod-openapi.js';
import { gameNamesQuerySchema, type GameNamesQuery } from './dto/game-names-query.dto.js';
import { GameNamesService } from './game-names.service.js';
import type { GameNamesResponse } from './game-names.types.js';

const EXAMPLE: GameNamesResponse = {
  locale: 'de_DE',
  builtAt: '2026-11-25T10:00:00.000Z',
  classes: { '3': 'Jäger', '7': 'Schamane' },
  specs: { '262': 'Elementar', '263': 'Verstärkung' },
  races: { '3': 'Zwerg', '26': 'Pandaren' },
  heroTalents: { '56': 'Scharfseher' },
  affixes: { '9': 'Tyrannisch', '10': 'Verstärkt' },
  dungeons: { 'altar-of-fangs': 'Altar der Fänge' },
  raids: { sporefall: { name: 'Sporenfall', bosses: { rotmire: 'Moderschlamm' } } },
};

@ApiTags('i18n')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('i18n')
export class GameNamesController {
  constructor(private readonly gameNames: GameNamesService) {}

  /** `GET /i18n/names?locale=de_DE` */
  @Get('names')
  @ApiOperation({
    summary: 'Game names in one language, to translate what Raider.io sends in English',
    description:
      'Class, spec, race, hero talent and affix names by Blizzard id (`classId`, `specId`, ' +
      '`raceId`, `heroTalentId`, affix `id`), and dungeon, raid and boss names by slug, from ' +
      "Blizzard's Game Data. A name Blizzard has not translated is English; one it has no " +
      'entry for is left out, so the front end keeps the English name it has. Rebuilt about ' +
      'once a week; `builtAt` changes when it is.',
  })
  @ApiZodQuery(gameNamesQuerySchema)
  @ApiOkResponse({ description: 'The names.', schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({ description: 'An unknown locale.' })
  @ApiBadGatewayResponse({ description: 'Blizzard failed and nothing is cached.' })
  @ApiServiceUnavailableResponse({
    description: 'The Blizzard budget is spent and nothing is cached; see Retry-After.',
  })
  names(
    @Query(new ZodValidationPipe(gameNamesQuerySchema, 'names query')) query: GameNamesQuery,
  ): Promise<GameNamesResponse> {
    return this.gameNames.names(query.locale);
  }
}
