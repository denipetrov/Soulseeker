import { Module } from '@nestjs/common';

import { PvpSeasonsService } from './seasons/pvp-seasons.service.js';

/**
 * The PvP leaderboards. Today: the seasons and their title cutoffs, cached,
 * for the leaderboard endpoint to read.
 */
@Module({
  providers: [PvpSeasonsService],
  exports: [PvpSeasonsService],
})
export class PvpModule {}
