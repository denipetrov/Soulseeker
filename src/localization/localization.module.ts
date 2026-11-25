import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { SeasonsModule } from '../seasons/seasons.module.js';
import { GameNamesController } from './game-names.controller.js';
import { GameNamesService } from './game-names.service.js';

/** Translated game names for the front end: `GET /i18n/names`. */
@Module({
  imports: [BlizzardModule, SeasonsModule],
  controllers: [GameNamesController],
  providers: [GameNamesService],
})
export class LocalizationModule {}
