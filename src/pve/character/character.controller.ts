import { Controller, Get, Query, Res } from '@nestjs/common';
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
import type { Response } from 'express';

import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import { PveCharacterService } from './character.service.js';
import type { PveCharacterResponse } from './character.types.js';
import { pveCharacterQuerySchema, type PveCharacterQuery } from './dto/character-query.dto.js';

const EXAMPLE: PveCharacterResponse = {
  region: 'us',
  realmSlug: 'demon-soul',
  character: {
    name: 'Manongauz',
    race: 'Human',
    class: 'Paladin',
    activeSpecName: 'Holy',
    gender: 'female',
    faction: 'alliance',
    realm: 'Demon Soul',
    region: 'us',
    thumbnailUrl:
      'https://render.worldofwarcraft.com/us/character/demon-soul/133/203724421-avatar.jpg',
  },
  guild: { name: 'veow' },
  gear: {
    itemLevelEquipped: 291,
    items: {
      head: {
        item_id: 271465,
        item_level: 308,
        name: 'Warhelm of the Consecrated Flame',
        icon: 'inv_helm_plate_raidpaladinulatek_d_01',
        bonuses: [13452, 13658],
        enchants_detail: [{ id: 243981, name: 'Enchant Helm - Empowered Blessing of Speed' }],
        gems_detail: [{ id: 240902, name: '16 Mast & 7 Vers' }],
      },
    },
  },
  talentLoadout: { loadout_spec_id: 65, loadout_text: 'CEEAAAAAAAAAAAAAAAAAAAAAAAAAALAwMAADWGmZ' },
  raidProgression: {
    'tier-mn-1': {
      summary: '',
      expansion_id: 11,
      total_bosses: 9,
      normal_bosses_killed: 0,
      heroic_bosses_killed: 0,
      mythic_bosses_killed: 0,
    },
  },
  mythicPlusScores: [
    { season: 'season-mn-2', scores: { all: 1760.9, dps: 0, healer: 1760.9, tank: 0 } },
  ],
  mythicPlusRanks: { overall: { world: 1964157, region: 422278, realm: 928 } },
  mythicPlusBestRuns: [
    {
      dungeon: 'Temple of Sethraliss',
      mythic_level: 14,
      completed_at: '2026-09-21T00:42:59.000Z',
      clear_time_ms: 1736151,
      num_keystone_upgrades: 1,
      score: 398.6,
      icon_url:
        'https://cdn.raiderio.net/images/wow/icons/large/achievement_dungeon_templeofsethraliss.jpg',
      background_image_url:
        'https://cdn.raiderio.net/images/dungeons/expansion7/base/temple-of-sethraliss.jpg',
      url: 'https://raider.io/mythic-plus-runs/season-mn-2/14738020-14-temple-of-sethraliss',
      affixes: [
        {
          id: 10,
          icon_url: 'https://cdn.raiderio.net/images/wow/icons/large/ability_toughness.jpg',
          wowhead_url: 'https://wowhead.com/affix=10',
        },
      ],
      spec: { id: 65 },
      role: 'healer',
    },
  ],
  fetchedAt: '2026-10-22T09:00:00.000Z',
  stale: false,
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class PveCharacterController {
  constructor(private readonly characters: PveCharacterService) {}

  /**
   * `GET /pve/character?region=us&realmSlug=demon-soul&characterName=Manongauz`
   *
   * `raidProgression=<raid slug>` and/or `mplusSeasonScore=<season slug>` ask
   * for just that part.
   */
  @Get('character')
  @ApiOperation({
    summary: 'One PvE character, from Raider.io',
    description:
      'Without `raidProgression` or `mplusSeasonScore`: the whole page — gear, talents, guild, ' +
      "the current expansion's raids, the current season's scores, ranks and best runs. With " +
      'either or both: only those parts, plus the base profile, which every answer carries. ' +
      'Raider.io answers in English; the front end translates. Cached; `stale` is true when ' +
      'an expired copy is served because Raider.io could not be asked.',
  })
  @ApiZodQuery(pveCharacterQuerySchema)
  @ApiOkResponse({ description: 'The character (whole page shown).', schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'A missing or invalid parameter, or a raid or season not in the catalogue.',
  })
  @ApiNotFoundResponse({ description: 'Raider.io has no such character.' })
  @ApiBadGatewayResponse({ description: 'Raider.io failed and nothing is cached.' })
  @ApiServiceUnavailableResponse({
    description: 'The Raider.io budget is spent and nothing is cached; see Retry-After.',
  })
  async character(
    @Query(new ZodValidationPipe(pveCharacterQuerySchema, 'character query'))
    query: PveCharacterQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PveCharacterResponse> {
    try {
      return await this.characters.character(query);
    } catch (error) {
      if (error instanceof BudgetSpentException) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
