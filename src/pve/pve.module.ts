import { Module } from '@nestjs/common';

import { RaiderIoModule } from '../raiderio/raiderio.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { PveCharacterController } from './character/character.controller.js';
import { PveCharacterService } from './character/character.service.js';

/** PvE character pages from Raider.io: raids, Mythic+ scores and runs, gear and talents. */
@Module({
  imports: [RaiderIoModule, RankwardenModule, SeasonsModule],
  controllers: [PveCharacterController],
  providers: [PveCharacterService],
})
export class PveModule {}
