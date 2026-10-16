import { Module } from '@nestjs/common';

import { SeasonsModule } from '../seasons/seasons.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [SeasonsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
