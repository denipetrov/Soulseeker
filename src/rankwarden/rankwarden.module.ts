import { Module } from '@nestjs/common';

import { RankwardenSyncClient } from './rankwarden-sync.client.js';

@Module({
  providers: [RankwardenSyncClient],
  exports: [RankwardenSyncClient],
})
export class RankwardenModule {}
