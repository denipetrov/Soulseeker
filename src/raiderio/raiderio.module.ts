import { Module } from '@nestjs/common';

import { RaiderIoCharacterApi } from './character.api.js';
import { RaiderIoHttpService } from './http/raiderio-http.service.js';

@Module({
  providers: [RaiderIoHttpService, RaiderIoCharacterApi],
  exports: [RaiderIoCharacterApi],
})
export class RaiderIoModule {}
