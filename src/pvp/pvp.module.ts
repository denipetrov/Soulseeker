import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { PvpCharacterController } from './character/character.controller.js';
import { CharacterLoader } from './character/character.loader.js';
import { PvpCharacterService } from './character/character.service.js';
import { LeaderboardController } from './leaderboard/leaderboard.controller.js';
import { LeaderboardService } from './leaderboard/leaderboard.service.js';
import { RepresentationController } from './representation/representation.controller.js';
import { RepresentationService } from './representation/representation.service.js';
import { PvpSeasonsService } from './seasons/pvp-seasons.service.js';

/**
 * The PvP leaderboards, the seasons and title cutoffs they show, spec
 * representation, and character pages from Blizzard.
 */
@Module({
  imports: [BlizzardModule, RankwardenModule],
  controllers: [LeaderboardController, RepresentationController, PvpCharacterController],
  providers: [
    PvpSeasonsService,
    LeaderboardService,
    RepresentationService,
    CharacterLoader,
    PvpCharacterService,
  ],
  exports: [PvpSeasonsService],
})
export class PvpModule {}
