import { Module } from '@nestjs/common';

import { LeaderboardController } from './leaderboard/leaderboard.controller.js';
import { LeaderboardService } from './leaderboard/leaderboard.service.js';
import { RepresentationController } from './representation/representation.controller.js';
import { RepresentationService } from './representation/representation.service.js';
import { PvpSeasonsService } from './seasons/pvp-seasons.service.js';

/** The PvP leaderboards, the seasons and title cutoffs they show, and spec representation. */
@Module({
  controllers: [LeaderboardController, RepresentationController],
  providers: [PvpSeasonsService, LeaderboardService, RepresentationService],
  exports: [PvpSeasonsService],
})
export class PvpModule {}
