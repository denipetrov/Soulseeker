import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { describeError } from '../../common/utils/errors.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { PveCatalogue, type CatalogueRaid } from '../../seasons/pve-catalogue.service.js';

export interface RaidsResponse {
  /** Newest expansion first, then the latest to open within it. */
  raids: CatalogueRaid[];
}

const EXAMPLE: RaidsResponse = {
  raids: [
    {
      slug: 'the-unbinding-of-kithix',
      name: "The Unbinding of Kith'ix",
      shortName: 'UOK',
      expansionId: 11,
      icon: 'inv_1215_raid_achievement_kithix',
      starts: {
        us: '2026-10-13T15:00:00.000Z',
        eu: '2026-10-14T04:00:00.000Z',
        tw: '2026-10-14T23:00:00.000Z',
        kr: '2026-10-14T23:00:00.000Z',
        cn: '2026-10-14T23:00:00.000Z',
      },
      ends: { us: null, eu: null, tw: null, kr: null, cn: null },
      encounters: [{ id: 197189, slug: 'kithix', name: "Kith'ix" }],
    },
    {
      slug: 'nerubar-palace',
      name: 'Nerub-ar Palace',
      shortName: 'NP',
      expansionId: 10,
      icon: 'inv_achievement_raid_nerubarpalace',
      starts: { us: '2024-09-10T15:00:00.000Z', eu: '2024-09-11T04:00:00.000Z' },
      ends: { us: '2025-02-25T15:00:00.000Z', eu: '2025-02-26T04:00:00.000Z' },
      encounters: [
        { id: 2902, slug: 'ulgrax-the-devourer', name: 'Ulgrax the Devourer' },
        { id: 2922, slug: 'queen-ansurek', name: 'Queen Ansurek' },
      ],
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class RaidsController {
  private readonly logger = new Logger(RaidsController.name);

  constructor(private readonly catalogue: PveCatalogue) {}

  /** `GET /pve/raids` */
  @Get('raids')
  @ApiOperation({
    summary: 'Every raid Rankwarden catalogues',
    description:
      'Each raid with its bosses in order, its icon and when it opened and closed in each ' +
      'region. Newest expansion first, then the latest to open within it. `ends` is null ' +
      'for a region where the raid is still open. `icon` is as Raider.io names it — an icon ' +
      'name or, on some raids, a numeric file id — and null before Battle for Azeroth. ' +
      'Served from Redis, shared by every replica and read from Rankwarden when missing; ' +
      'up to a day behind it.',
  })
  @ApiOkResponse({ description: 'The raids.', schema: { example: EXAMPLE } })
  @ApiServiceUnavailableResponse({
    description: 'The raids are not in Redis and could not be read from Rankwarden.',
  })
  async raids(): Promise<RaidsResponse> {
    try {
      return { raids: await this.catalogue.raids() };
    } catch (error) {
      // Only when the list is missing from Redis and Mongo could not be read.
      this.logger.warn(`Raids not served, none cached and none read: ${describeError(error)}`);
      throw new ServiceUnavailableException({ message: 'The raid catalogue is not available' });
    }
  }
}
