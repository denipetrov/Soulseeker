import { Module } from '@nestjs/common';

import { CurrentSeasons } from './current-seasons.service.js';
import { PveCatalogue } from './pve-catalogue.service.js';

@Module({
  providers: [CurrentSeasons, PveCatalogue],
  exports: [CurrentSeasons, PveCatalogue],
})
export class SeasonsModule {}
