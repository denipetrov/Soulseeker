import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { PvpCharacterController } from './character/character.controller.js';
import { CharacterLoader } from './character/character.loader.js';
import { PvpCharacterService } from './character/character.service.js';
import { CutoffsController } from './cutoffs/cutoffs.controller.js';
import { CutoffsService } from './cutoffs/cutoffs.service.js';
import { BoardEnricher } from './leaderboard/board-enricher.service.js';
import { LeaderboardController } from './leaderboard/leaderboard.controller.js';
import { LeaderboardService } from './leaderboard/leaderboard.service.js';
import { RepresentationController } from './representation/representation.controller.js';
import { RepresentationService } from './representation/representation.service.js';
import { PvpSeasonsService } from './seasons/pvp-seasons.service.js';

/**
 * The PvP leaderboards, the seasons and title cutoffs they show, spec
 * representation, title cutoffs with who reaches them, and character pages from Blizzard.
 */
@Module({
  imports: [BlizzardModule, RankwardenModule],
  controllers: [
    LeaderboardController,
    RepresentationController,
    PvpCharacterController,
    CutoffsController,
  ],
  providers: [
    PvpSeasonsService,
    BoardEnricher,
    LeaderboardService,
    RepresentationService,
    CharacterLoader,
    PvpCharacterService,
    CutoffsService,
  ],
  exports: [PvpSeasonsService],
})
export class PvpModule {}
