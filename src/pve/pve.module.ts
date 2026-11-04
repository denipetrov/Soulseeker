import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { RaiderIoModule } from '../raiderio/raiderio.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { BossesController } from './bosses/bosses.controller.js';
import { BossesService } from './bosses/bosses.service.js';
import { PveCharacterController } from './character/character.controller.js';
import { PveCharacterService } from './character/character.service.js';
import { GuildController } from './guild/guild.controller.js';
import { GuildService } from './guild/guild.service.js';
import { MplusLeaderboardController } from './mplus-leaderboard/mplus-leaderboard.controller.js';
import { MplusLeaderboardService } from './mplus-leaderboard/mplus-leaderboard.service.js';
import { RaidController } from './raid/raid.controller.js';
import { RaidService } from './raid/raid.service.js';
import { RaidsController } from './raids/raids.controller.js';
import { GuildRefs } from './shared/guild-refs.service.js';

/**
 * PvE pages from Raider.io: characters (raids, Mythic+ scores and runs, gear and
 * talents) and guilds (progression, rankings, roster, raid encounters, boss kills);
 * the raid list and one raid's top guilds, from Rankwarden's `raids`; and each boss's first
 * kills, from its `bosses`; and the Mythic+ character leaderboard.
 */
@Module({
  imports: [RaiderIoModule, BlizzardModule, RankwardenModule, SeasonsModule],
  controllers: [
    PveCharacterController,
    GuildController,
    RaidsController,
    RaidController,
    BossesController,
    MplusLeaderboardController,
  ],
  providers: [
    PveCharacterService,
    GuildService,
    BossesService,
    RaidService,
    GuildRefs,
    MplusLeaderboardService,
  ],
})
export class PveModule {}
