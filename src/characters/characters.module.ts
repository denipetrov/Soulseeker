import { Module } from '@nestjs/common';

import { BlizzardModule } from '../blizzard/blizzard.module.js';
import { RaiderIoModule } from '../raiderio/raiderio.module.js';
import { RankwardenModule } from '../rankwarden/rankwarden.module.js';

/**
 * Character lookups for the front end: what Rankwarden stored, refreshed on
 * demand from Blizzard and Raider.io, cached in Redis, and pushed back to
 * Rankwarden. The upstream clients and the sync client are wired in; the
 * controllers and services that use them are the next piece of work.
 */
@Module({
  imports: [BlizzardModule, RaiderIoModule, RankwardenModule],
})
export class CharactersModule {}
