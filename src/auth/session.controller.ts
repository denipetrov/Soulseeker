import { Controller, Get, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { BEARER_AUTH } from '../docs/swagger.js';
import type { AuthenticatedRequest } from './access-token.guard.js';

/**
 * `GET /session`: who the presented token says the caller is. Lets the front
 * end confirm a token works before it relies on it, and is the simplest
 * protected route there is.
 */
@ApiTags('auth')
@ApiBearerAuth(BEARER_AUTH)
@Controller('session')
export class SessionController {
  @Get()
  @ApiOperation({ summary: 'Who the access token says the caller is' })
  @ApiOkResponse({
    description: 'The token is valid.',
    schema: {
      example: {
        subject: 'anon:0eede3d6-1a4b-4761-89b6-fba668ecc00a',
        anonymous: true,
        scopes: ['api:read'],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'No, an invalid or an expired access token.' })
  current(@Req() req: AuthenticatedRequest) {
    const auth = req.auth!;

    return {
      subject: auth.subject,
      anonymous: auth.subject.startsWith('anon:'),
      scopes: [...auth.scopes],
    };
  }
}
