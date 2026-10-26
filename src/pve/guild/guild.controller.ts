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
import { guildQuerySchema, type GuildQuery } from './dto/guild-query.dto.js';
import { GuildService } from './guild.service.js';
import type {
  GuildBase,
  GuildBossKillResponse,
  GuildRaidEncountersResponse,
  GuildResponse,
  GuildSummaryResponse,
} from './guild.types.js';

const GUILD: GuildBase = {
  name: 'Echo',
  displayName: null,
  faction: 'horde',
  realm: 'Tarren Mill',
  region: 'eu',
  profileUrl: 'https://raider.io/guilds/eu/tarren-mill/Echo',
  lastCrawledAt: '2026-10-26T07:14:48.000Z',
};

const SUMMARY: GuildSummaryResponse = {
  region: 'eu',
  realmSlug: 'tarren-mill',
  guild: GUILD,
  raidProgression: {
    'tier-mn-1': {
      summary: '9/9 M',
      total_bosses: 9,
      normal_bosses_killed: 8,
      heroic_bosses_killed: 8,
      mythic_bosses_killed: 9,
    },
  },
  raidRankings: {
    'tier-mn-1': {
      normal: { world: 14777, region: 6531, realm: 288 },
      heroic: { world: 12084, region: 5297, realm: 267 },
      mythic: { world: 2, region: 1, realm: 1 },
    },
  },
  members: [
    {
      rank: 1,
      character: {
        name: 'Justwait',
        race: 'Blood Elf',
        class: 'Demon Hunter',
        active_spec_name: 'Vengeance',
        active_spec_role: 'TANK',
        faction: 'horde',
        realm: 'Tarren Mill',
        profile_url: 'https://raider.io/characters/eu/tarren-mill/Justwait',
      },
    },
  ],
  fetchedAt: '2026-10-26T09:00:00.000Z',
  stale: false,
};

const RAID: GuildRaidEncountersResponse = {
  region: 'eu',
  realmSlug: 'tarren-mill',
  guild: GUILD,
  raid: 'tier-mn-1',
  difficulty: 'mythic',
  encounters: [
    { slug: 'midnight-falls', name: 'Midnight Falls', defeatedAt: '2026-04-07T12:23:33.000Z' },
  ],
  fetchedAt: '2026-10-26T09:00:00.000Z',
  stale: false,
};

const BOSS: GuildBossKillResponse = {
  region: 'eu',
  realmSlug: 'tarren-mill',
  guildName: 'echo',
  raid: 'tier-mn-1',
  boss: 'midnight-falls',
  difficulty: 'mythic',
  kill: {
    pulledAt: '2026-04-07T12:13:37.541Z',
    defeatedAt: '2026-04-07T12:23:33.563Z',
    durationMs: 596022,
    isSuccess: true,
    itemLevelEquippedAvg: 279.7,
  },
  roster: [{ character: { id: 167927464, name: 'Gingipumper' }, vantus: true }],
  fetchedAt: '2026-10-26T09:00:00.000Z',
  stale: false,
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class GuildController {
  constructor(private readonly guilds: GuildService) {}

  /**
   * `GET /pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo`
   *
   * One widget per call: the summary, `showFullRoster=true`,
   * `raidEncounters=<raid>&difficulty=<difficulty>`, or the same plus `boss=<boss>`.
   */
  @Get('guild')
  @ApiOperation({
    summary: 'One guild, from Raider.io',
    description:
      'Without options: the summary — the current expansion’s progression and rankings, and ' +
      'the members of ranks 0 and 1. `showFullRoster=true`: every member, never cached. ' +
      '`raidEncounters` + `difficulty`: the bosses of that raid the guild killed, with when. ' +
      'Adding `boss`: the guild’s kill of that boss with its full roster, as Raider.io returns ' +
      'it; `kill` is null when the guild has not killed it. One widget per call: other ' +
      'combinations are a 400.',
  })
  @ApiZodQuery(guildQuerySchema)
  @ApiOkResponse({
    description: 'The summary, the roster, a raid’s encounters, or a boss kill.',
    schema: { examples: { summary: SUMMARY, raidEncounters: RAID, boss: BOSS } },
  })
  @ApiBadRequestResponse({
    description:
      'A missing or invalid parameter, a combination of widgets, or a raid or boss not in the ' +
      'catalogue.',
  })
  @ApiNotFoundResponse({ description: 'Raider.io has no such guild.' })
  @ApiBadGatewayResponse({ description: 'Raider.io failed and nothing is cached.' })
  @ApiServiceUnavailableResponse({
    description: 'The Raider.io budget is spent and nothing is cached; see Retry-After.',
  })
  async guild(
    @Query(new ZodValidationPipe(guildQuerySchema, 'guild query')) query: GuildQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GuildResponse> {
    try {
      return await this.guilds.guild(query);
    } catch (error) {
      if (error instanceof BudgetSpentException) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
