import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RunLogger } from '@denipetrov/spirit-link/logging';
import { searchNameOf } from '@denipetrov/spirit-link/search';

import { Public } from '../auth/public.decorator.js';
import type { GuildDocument } from '../characters/entities/guild.entity.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Collections, Indexes } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import type { SetHiddenInput } from '../rankwarden/dto/set-hidden.dto.js';
import { RankwardenSyncClient } from '../rankwarden/rankwarden-sync.client.js';
import { ADMIN_KEY_HEADER, AdminKeyGuard } from './admin-key.guard.js';
import { adminHiddenSchema, type AdminHiddenInput } from './dto/admin-hidden.dto.js';
import { HiddenList } from './hidden-list.service.js';

const EXAMPLE = {
  kind: 'character',
  region: 'eu',
  realmSlug: 'tarren-mill',
  name: 'Grøäx',
  hidden: true,
  updated: { characters: 2, mplusCharacters: 1 },
};

/**
 * Hiding players and guilds from every answer of this API.
 *
 * Soulseeker writes nothing to MongoDB: this hands the change to Rankwarden's
 * `POST /hidden`, which keeps the list (`hidden_entries`), then drops the
 * cached list and the cached answers filtered by it, so every replica leaves
 * the player or guild out from the next request.
 *
 * Not a visitor route: no OAuth token, an admin key instead (`AdminKeyGuard`).
 */
@ApiTags('admin')
@ApiHeader({ name: ADMIN_KEY_HEADER, required: true, description: 'The admin key.' })
@ApiUnauthorizedResponse({ description: 'A missing or wrong admin key.' })
@Public()
@UseGuards(AdminKeyGuard)
@Controller('admin')
export class AdminHiddenController {
  private readonly logger = new RunLogger(AdminHiddenController.name);

  constructor(
    private readonly rankwarden: RankwardenSyncClient,
    private readonly hidden: HiddenList,
    private readonly mongo: MongoService,
  ) {}

  /** `POST /admin/hidden` */
  @Post('hidden')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hide or show a player or a guild',
    description:
      'A player by region, realm and name, hidden in PvP and Mythic+ in every season; a guild ' +
      'by Raider.io id, or by region, realm and name. Idempotent. `hidden: false` shows them ' +
      'again. Every answer of this API leaves them out from the next request.',
  })
  @ApiOkResponse({ description: "Recorded; Rankwarden's answer.", schema: { example: EXAMPLE } })
  @ApiBadRequestResponse({ description: 'An invalid body.' })
  @ApiNotFoundResponse({
    description:
      'A guild named by realm and name that Rankwarden does not store; or no admin key is configured.',
  })
  async setHidden(
    @Body(new ZodValidationPipe(adminHiddenSchema, 'hidden request')) body: AdminHiddenInput,
  ): Promise<unknown> {
    const input: SetHiddenInput =
      body.kind === 'character'
        ? body
        : {
            kind: 'guild',
            guildId: body.guildId ?? (await this.guildIdOf(body)),
            hidden: body.hidden,
          };

    const outcome = await this.rankwarden.setHidden(input);

    if (outcome.status === 'invalid') {
      throw new BadRequestException({
        message: 'Rankwarden refused the request',
        reason: outcome.reason,
      });
    }
    if (outcome.status !== 'written') {
      throw new BadGatewayException('Rankwarden could not be reached; nothing changed. Retry.');
    }

    await this.hidden.invalidate();
    this.logger.log(
      `${input.kind === 'guild' ? `Guild ${input.guildId}` : `Player ${input.region}/${input.realmSlug}/${input.name}`} ` +
        (input.hidden ? 'hidden' : 'shown'),
    );

    return outcome.result;
  }

  /** A guild's Raider.io id, from Rankwarden's `guilds` by region, realm and name. */
  private async guildIdOf(guild: {
    region?: string;
    realmSlug?: string;
    name?: string;
  }): Promise<number> {
    const docs = await this.mongo
      .collection<GuildDocument>(Collections.Guilds)
      .find(
        {
          searchName: searchNameOf(guild.name!),
          region: guild.region!,
          'realm.slug': guild.realmSlug!,
        },
        { projection: { _id: 0, id: 1, name: 1 }, hint: Indexes.GuildSearch },
      )
      .toArray();
    // The folded name can match two guilds (`Bìbà`, `Biba`): the exact name decides.
    const exact = docs.filter(
      (doc) =>
        doc.name.normalize('NFC').toLowerCase() === guild.name!.normalize('NFC').toLowerCase(),
    );
    const match = exact.length === 1 ? exact[0] : docs.length === 1 ? docs[0] : undefined;

    if (!match) {
      throw new NotFoundException({
        message: 'No such guild stored in Rankwarden; give its Raider.io guildId instead',
      });
    }

    return match.id;
  }
}
