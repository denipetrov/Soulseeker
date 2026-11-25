import { Global, Module } from '@nestjs/common';

import { RankwardenModule } from '../rankwarden/rankwarden.module.js';
import { AdminHiddenController } from './admin-hidden.controller.js';
import { AdminKeyGuard } from './admin-key.guard.js';
import { HiddenList } from './hidden-list.service.js';

/**
 * Hidden players and guilds: `POST /admin/hidden`, and `HiddenList`, which
 * every reader of characters and guilds asks. Global, as those readers are in
 * every feature module.
 */
@Global()
@Module({
  imports: [RankwardenModule],
  controllers: [AdminHiddenController],
  providers: [HiddenList, AdminKeyGuard],
  exports: [HiddenList],
})
export class HiddenModule {}
