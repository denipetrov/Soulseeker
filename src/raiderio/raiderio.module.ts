import { Module } from '@nestjs/common';

import { RaiderIoCharacterApi } from './character.api.js';
import { RaiderIoGuildApi } from './guild.api.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import { RaiderIoMythicPlusApi } from './mythic-plus.api.js';

@Module({
  providers: [RaiderIoHttpService, RaiderIoCharacterApi, RaiderIoGuildApi, RaiderIoMythicPlusApi],
  exports: [RaiderIoCharacterApi, RaiderIoGuildApi, RaiderIoMythicPlusApi],
})
export class RaiderIoModule {}
