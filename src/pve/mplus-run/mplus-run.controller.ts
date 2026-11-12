import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import { mplusRunQuerySchema, type MplusRunQuery } from './dto/mplus-run-query.dto.js';
import { MplusRunService } from './mplus-run.service.js';
import type { MplusRunResponse } from './mplus-run.types.js';

const EXAMPLE: MplusRunResponse = {
  season: 'season-mn-2',
  keystone_run_id: 19324786,
  dungeon: {
    id: 16091,
    name: 'Murder Row',
    short_name: 'MR',
    slug: 'murder-row',
    icon_url: '/images/wow/icons/large/inv_achievement_dungeon_murderrow.jpg',
    keystone_timer_ms: 2040999,
    num_bosses: 4,
  },
  mythic_level: 22,
  score: 519,
  clear_time_ms: 1824300,
  keystone_time_ms: 2040999,
  time_remaining_ms: 216699,
  num_chests: 1,
  completed_at: '2026-10-09T00:24:13.000Z',
  faction: 'alliance',
  weekly_modifiers: [
    {
      id: 9,
      icon: 'achievement_boss_archaedas',
      name: 'Tyrannical',
      slug: 'tyrannical',
      description: 'Bosses have 25% more health.',
    },
  ],
  roster: [
    {
      character: {
        id: 138628728,
        name: 'Bondd',
        class: { id: 7, name: 'Shaman', slug: 'shaman' },
        spec: { id: 262, name: 'Elemental', slug: 'elemental', role: 'dps' },
        realm: { name: 'Illidan', slug: 'illidan' },
        region: { slug: 'us' },
      },
      role: 'dps',
      guild: null,
      items: {},
      ranks: {},
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class MplusRunController {
  constructor(private readonly runService: MplusRunService) {}

  /** `GET /pve/mplus-run?keystoneRunId=19324786` */
  @Get('mplus-run')
  @ApiOperation({
    summary: 'One Mythic+ run, from Raider.io',
    description:
      'The run’s dungeon, level, score, times, chests, affixes and its five players as ' +
      'Raider.io gives them (talents, items, ranks), in Raider.io’s own field names. The ' +
      'season is found from the stored runs, or the current one; pass `season` for a run ' +
      'Rankwarden does not hold from an earlier season. Cached for a day: a finished run ' +
      'does not change.',
  })
  @ApiZodQuery(mplusRunQuerySchema)
  @ApiOkResponse({ description: 'The run.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({ description: 'No such run in the season, or an unknown season.' })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  @ApiServiceUnavailableResponse({ description: 'The Raider.io budget is spent; see Retry-After.' })
  @ApiBadGatewayResponse({ description: 'Raider.io could not be reached.' })
  run(
    @Query(new ZodValidationPipe(mplusRunQuerySchema, 'Mythic+ run query')) query: MplusRunQuery,
  ): Promise<MplusRunResponse> {
    return this.runService.run(query);
  }
}
