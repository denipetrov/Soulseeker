import { Module } from '@nestjs/common';

import { RaiderIoCharacterApi } from './character.api.js';
import { RaiderIoGuildApi } from './guild.api.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';

@Module({
  providers: [RaiderIoHttpService, RaiderIoCharacterApi, RaiderIoGuildApi],
  exports: [RaiderIoCharacterApi, RaiderIoGuildApi],
})
export class RaiderIoModule {}
