import { Module } from '@nestjs/common';

import { LeaderboardController } from './leaderboard/leaderboard.controller.js';
import { LeaderboardService } from './leaderboard/leaderboard.service.js';
import { PvpSeasonsService } from './seasons/pvp-seasons.service.js';

/** The PvP leaderboards, and the seasons and title cutoffs they show. */
@Module({
  controllers: [LeaderboardController],
  providers: [PvpSeasonsService, LeaderboardService],
  exports: [PvpSeasonsService],
})
export class PvpModule {}
