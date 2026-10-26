import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { RaiderIoModule } from '../raiderio/raiderio.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { PveCharacterController } from './character/character.controller.js';
import { PveCharacterService } from './character/character.service.js';
import { GuildController } from './guild/guild.controller.js';
import { GuildService } from './guild/guild.service.js';

/**
 * PvE pages from Raider.io: characters (raids, Mythic+ scores and runs, gear and
 * talents) and guilds (progression, rankings, roster, raid encounters, boss kills).
 */
@Module({
  imports: [RaiderIoModule, BlizzardModule, RankwardenModule, SeasonsModule],
  controllers: [PveCharacterController, GuildController],
  providers: [PveCharacterService, GuildService],
})
export class PveModule {}
