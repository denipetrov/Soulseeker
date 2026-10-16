import { Module } from '@nestjs/common';

import { CurrentSeasons } from './current-seasons.service.js';

@Module({
  providers: [CurrentSeasons],
  exports: [CurrentSeasons],
})
export class SeasonsModule {}
