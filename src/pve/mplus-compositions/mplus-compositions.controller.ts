import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BEARER_AUTH } from '../../docs/swagger.js';
import { ApiZodQuery } from '../../docs/zod-openapi.js';
import {
  mplusCompositionsQuerySchema,
  type MplusCompositionsQuery,
} from './dto/mplus-compositions-query.dto.js';
import { MplusCompositionsService } from './mplus-compositions.service.js';
import type { CompositionMember, MplusCompositionsResponse } from './mplus-compositions.types.js';

const member = (
  cls: string,
  spec: string,
  classId: number,
  className: string,
  specId: number,
  specName: string,
  role: string,
): CompositionMember => ({ class: cls, spec, classId, className, specId, specName, role });

const EXAMPLE: MplusCompositionsResponse = {
  region: 'world',
  season: 'season-mn-2',
  current: true,
  dungeon: null,
  top: 1000,
  runs: 1000,
  compositions: [
    {
      rank: 1,
      count: 87,
      share: 0.087,
      members: [
        member('deathknight', 'blood', 6, 'Death Knight', 250, 'Blood', 'tank'),
        member('priest', 'discipline', 5, 'Priest', 256, 'Discipline', 'healer'),
        member('mage', 'arcane', 8, 'Mage', 62, 'Arcane', 'dps'),
        member('shaman', 'elemental', 7, 'Shaman', 262, 'Elemental', 'dps'),
        member('evoker', 'augmentation', 13, 'Evoker', 1473, 'Augmentation', 'dps'),
      ],
    },
  ],
};

@ApiTags('pve')
@ApiBearerAuth(BEARER_AUTH)
@ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit reached; see Retry-After.' })
@Controller('pve')
export class MplusCompositionsController {
  constructor(private readonly compositionsService: MplusCompositionsService) {}

  /** `GET /pve/mplus-compositions?region=eu&dungeon=murder-row&top=1000` */
  @Get('mplus-compositions')
  @ApiOperation({
    summary: 'The most played Mythic+ compositions among the best runs',
    description:
      'The board of `GET /pve/mplus-runs` (same `region`, `season` and `dungeon`) read to ' +
      'its `top` best runs, 1000 by default, and the 50 compositions that finished most of ' +
      'them. A composition is the party’s class and spec pairs, whoever played them and in ' +
      'whatever order: members come tank, healer, then damage dealers. `count` is the runs ' +
      'it finished, `share` of `runs`, the runs read. Equal counts rank by their best run. ' +
      'Cached for 5 minutes.',
  })
  @ApiZodQuery(mplusCompositionsQuerySchema)
  @ApiOkResponse({ description: 'The most played compositions.', schema: { example: EXAMPLE } })
  @ApiNotFoundResponse({
    description:
      'A season the catalogue does not know, no current season recorded, or a dungeon the ' +
      'season does not run.',
  })
  @ApiBadRequestResponse({ description: 'A missing or invalid parameter; every one is listed.' })
  compositions(
    @Query(new ZodValidationPipe(mplusCompositionsQuerySchema, 'Mythic+ compositions query'))
    query: MplusCompositionsQuery,
  ): Promise<MplusCompositionsResponse> {
    return this.compositionsService.compositions(query);
  }
}
