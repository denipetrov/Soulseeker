import { Module } from '@nestjs/common';

import { RaiderIoCharacterApi } from './character.api.js';
import { RaiderIoGuildApi } from './guild.api.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';
import { RaiderIoRunApi } from './run.api.js';

@Module({
  providers: [RaiderIoHttpService, RaiderIoCharacterApi, RaiderIoGuildApi, RaiderIoRunApi],
  exports: [RaiderIoCharacterApi, RaiderIoGuildApi, RaiderIoRunApi],
})
export class RaiderIoModule {}
