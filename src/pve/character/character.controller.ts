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

const RUN = {
  dungeon: 'Den of Nalorakk',
  mythic_level: 23,
  completed_at: '2026-10-22T15:28:33.000Z',
  clear_time_ms: 1595637,
  par_time_ms: 1920999,
  num_keystone_upgrades: 1,
  score: 536.3,
  icon_url:
    'https://cdn.raiderio.net/images/wow/icons/large/inv_achievement_dungeon_proveyourworth.jpg',
  background_image_url:
    'https://cdn.raiderio.net/images/dungeons/expansion11/base/den-of-nalorakk.jpg',
  url: 'https://raider.io/mythic-plus-runs/season-mn-2/22217808-23-den-of-nalorakk',
  affixes: [
    {
      id: 10,
      icon_url: 'https://cdn.raiderio.net/images/wow/icons/large/ability_toughness.jpg',
      wowhead_url: 'https://wowhead.com/affix=10',
    },
  ],
  spec: { id: 262 },
  role: 'dps',
};

const EXAMPLE: PveCharacterResponse = {
  region: 'eu',
  realmSlug: 'tarren-mill',
  character: {
    name: 'Stoveteacher',
    race: 'Dwarf',
    class: 'Shaman',
    activeSpecName: 'Elemental',
    activeSpecRole: 'DPS',
    gender: 'female',
    faction: 'alliance',
    realm: 'Tarren Mill',
    region: 'eu',
    thumbnailUrl:
      'https://render.worldofwarcraft.com/eu/character/tarren-mill/108/190854508-avatar.jpg',
    achievementPoints: 22250,
    profileBanner: 'classbanner_shaman1',
    profileUrl: 'https://raider.io/characters/eu/tarren-mill/Stoveteacher',
    lastCrawledAt: '2026-10-22T00:28:40.000Z',
  },
  guild: { name: 'Echo', realm: 'Tarren Mill' },
  gear: {
    itemLevelEquipped: 337,
    items: {
      head: {
        item_id: 271465,
        item_level: 340,
        name: 'Helm of the Stormcaller',
        icon: 'inv_helm_mail_raidshaman_d_01',
        item_quality: 4,
        tier: '36',
        bonuses: [13452, 13658],
        enchants_detail: [{ id: 243981, name: 'Enchant Helm - Empowered Blessing of Speed' }],
        gems_detail: [{ id: 240902, name: '16 Mast & 7 Vers' }],
      },
    },
  },
  talentLoadout: { loadout_spec_id: 262, loadout_text: 'CYQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzMzYmZ' },
  raidProgression: {
    'tier-mn-1': {
      summary: '9/9 M',
      expansion_id: 11,
      total_bosses: 9,
      normal_bosses_killed: 9,
      heroic_bosses_killed: 9,
      mythic_bosses_killed: 9,
    },
  },
  raidAchievementCurve: [
    {
      raid: 'tier-mn-1',
      aotc: '2026-05-11T18:25:00.000Z',
      cutting_edge: '2026-05-11T18:25:00.000Z',
    },
  ],
  raidBosses: {
    'tier-mn-1': [
      {
        slug: 'imperator-averzian',
        name: 'Imperator Averzian',
        kills: {
          heroic: { count: 3, lastKillAt: '2026-04-02T19:40:11.000Z' },
          mythic: { count: 6, lastKillAt: '2026-05-11T18:25:00.000Z' },
        },
      },
    ],
  },
  mythicPlusScores: [
    {
      season: 'season-mn-2',
      scores: { all: 4256.3, dps: 4256.3, healer: 0, tank: 0 },
      colors: { all: '#fe7e15', dps: '#fe7e15', healer: '#ffffff', tank: '#ffffff' },
      topPercent: { percent: 0.1, minScore: 3920.4 },
    },
    {
      season: 'season-mn-1',
      scores: { all: 1220, dps: 1220, healer: 0, tank: 0 },
      colors: { all: '#b9ffa2', dps: '#b9ffa2', healer: '#ffffff', tank: '#ffffff' },
      topPercent: null,
    },
  ],
  mythicPlusRanks: { overall: { world: 49, region: 22, realm: 4 } },
  mythicPlusBestRuns: [RUN],
  mythicPlusRecentRuns: [RUN],
  mythicPlusHighestLevelRuns: [RUN],
  mythicPlusWeeklyHighestLevelRuns: [RUN],
  mythicPlusPreviousWeeklyHighestLevelRuns: [],
  fetchedAt: '2026-10-23T09:00:00.000Z',
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
