import { Controller, Get, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from './access-token.guard.js';

/**
 * `GET /session`: who the presented token says the caller is. Lets the front
 * end confirm a token works before it relies on it, and is the simplest
 * protected route there is.
 */
@Controller('session')
export class SessionController {
  @Get()
  current(@Req() req: AuthenticatedRequest) {
    const auth = req.auth!;

    return {
      subject: auth.subject,
      anonymous: auth.subject.startsWith('anon:'),
      scopes: [...auth.scopes],
    };
  }
}
