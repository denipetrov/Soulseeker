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
import { MplusCompositionsController } from './mplus-compositions/mplus-compositions.controller.js';
import { MplusCompositionsService } from './mplus-compositions/mplus-compositions.service.js';
import { MplusRunsController } from './mplus-runs/mplus-runs.controller.js';
import { MplusRunsService } from './mplus-runs/mplus-runs.service.js';
import { MplusSeasonsController } from './mplus-seasons/mplus-seasons.controller.js';
import { MplusSeasonsService } from './mplus-seasons/mplus-seasons.service.js';
import { PveRepresentationController } from './spec-representation/pve-representation.controller.js';
import { PveRepresentationService } from './spec-representation/pve-representation.service.js';
import { RaidController } from './raid/raid.controller.js';
import { RaidService } from './raid/raid.service.js';
import { RaidsController } from './raids/raids.controller.js';
import { GuildRefs } from './shared/guild-refs.service.js';
import { MplusSeasonResolver } from './shared/mplus-season.resolver.js';

/**
 * PvE pages from Raider.io: characters (raids, Mythic+ scores and runs, gear and
 * talents) and guilds (progression, rankings, roster, raid encounters, boss kills);
 * the raid list and one raid's top guilds, from Rankwarden's `raids`; and each boss's first
 * kills, from its `bosses`; the Mythic+ character and run boards and the most played
 * compositions and spec representation; and the Mythic+ seasons,
 * dungeons and affixes.
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
    MplusSeasonsController,
    MplusRunsController,
    MplusCompositionsController,
    PveRepresentationController,
  ],
  providers: [
    PveCharacterService,
    GuildService,
    BossesService,
    RaidService,
    GuildRefs,
    MplusLeaderboardService,
    MplusSeasonsService,
    MplusSeasonResolver,
    MplusRunsService,
    MplusCompositionsService,
    PveRepresentationService,
  ],
})
export class PveModule {}
