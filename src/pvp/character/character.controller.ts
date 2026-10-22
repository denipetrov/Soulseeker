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

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { PvpCharacterService } from './character.service.js';
import type { PvpCharacterResponse } from './character.types.js';
import { characterQuerySchema, type CharacterQuery } from './dto/character-query.dto.js';

const EXAMPLE: PvpCharacterResponse = {
  region: 'us',
  locale: 'en_US',
  seasonId: 42,
  character: {
    id: 203724421,
    name: 'Manongauz',
    realm: { id: 1286, slug: 'demon-soul', name: 'Demon Soul' },
    faction: 'alliance',
    level: 90,
    gender: { type: 'female', name: 'Female' },
    race: { id: 1, name: 'Human' },
    class: { id: 2, name: 'Paladin' },
    activeSpec: { id: 65, name: 'Holy' },
    activeTitle: {
      id: 411,
      name: 'Corrupted Gladiator',
      displayString: 'Corrupted Gladiator {name}',
    },
    guild: { id: 91360489, name: 'veow' },
    averageItemLevel: 306,
    equippedItemLevel: 291,
    lastLoginAt: '2026-10-20T18:04:42.000Z',
  },
  media: {
    avatar: 'https://render.worldofwarcraft.com/us/character/demon-soul/133/203724421-avatar.jpg',
    mainRaw:
      'https://render.worldofwarcraft.com/us/character/demon-soul/133/203724421-main-raw.png',
  },
  brackets: [
    {
      bracket: 'shuffle-paladin-holy',
      rating: 2729,
      played: 29,
      won: 28,
      lost: 1,
      specialization: { id: 65, name: 'Holy' },
    },
  ],
  honor: { level: 1991, honorableKills: 10516 },
  specializations: {
    activeSpecialization: { id: 65, name: 'Holy' },
    activeHeroTalentTree: { id: 49, name: 'Lightsmith' },
    specializations: [
      {
        specialization: { id: 65, name: 'Holy' },
        pvpTalentSlots: [
          { slotNumber: 2, selected: { talent: { id: 640, name: 'Divine Vision' } } },
        ],
        loadout: {
          talentLoadoutCode: 'CEEAzbn3egSOtoSwvPw1U1vTLAAAALAwMAADWGmZMzyMjlZMDsxyMziZaiZZ',
          heroTalentTree: { id: 49, name: 'Lightsmith' },
          classTalents: [{ id: 99839, rank: 1 }],
          specTalents: [],
          heroTalents: [],
        },
      },
    ],
  },
  statistics: {
    avoidance: { value: 0, rating: 0 },
    lifesteal: { value: 0, rating: 0 },
    speed: { value: 8.52, rating: 98 },
    mastery: { value: 64.89, rating: 1208 },
    meleeCrit: { value: 11.63, rating: 121 },
    meleeHaste: { value: 0, rating: 0 },
    versatilityDamageDoneBonus: 23.72,
  },
  equipment: {
    items: [{ item: { id: 271465 }, slot: { type: 'HEAD', name: 'Head' } }],
    sets: [{ item_set: { id: 1458, name: "Gladiator's Distinction" } }],
  },
  pvpHistory: [
    {
      achievementId: 40393,
      name: 'Gladiator: The War Within Season 1',
      tier: 'gladiator',
      division: null,
      expansion: 'The War Within',
      seasonNumber: 1,
      seasonId: 39,
      bracket: null,
      completedAt: '2025-01-25T00:00:00.000Z',
      earnedByThisCharacter: true,
    },
  ],
  fetchedAt: '2026-10-21T09:00:00.000Z',
  stale: false,
};

@ApiTags('pvp')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pvp')
export class PvpCharacterController {
  constructor(private readonly characters: PvpCharacterService) {}

  /**
   * `GET /pvp/character?region=us&realmSlug=demon-soul&characterName=Manongauz&locale=en_US`
   *
   * Cached for hours; `forceRefresh=true` asks Blizzard again, at most once
   * per character every few minutes.
   */
  @Get('character')
  @ApiOperation({
    summary: 'One PvP character, from Blizzard',
    description:
      'Profile, ratings on every ladder played this season, talents, PvP talents, stats, ' +
      'equipment, render URLs and the PvP titles the account earned, in the language asked ' +
      'for. Cached; `stale` is true when an expired copy is served because Blizzard could ' +
      'not be asked.',
  })
  @ApiZodQuery(characterQuerySchema)
  @ApiOkResponse({ description: 'The character.', schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  @ApiNotFoundResponse({ description: 'Blizzard has no such character.' })
  @ApiBadGatewayResponse({ description: 'Blizzard failed and nothing is cached.' })
  @ApiServiceUnavailableResponse({
    description: 'The Blizzard budget is spent and nothing is cached; see Retry-After.',
  })
  async character(
    @Query(new ZodValidationPipe(characterQuerySchema, 'character query'))
    query: CharacterQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PvpCharacterResponse> {
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
