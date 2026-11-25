import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../config/env.schema.js';

/** The header the admin key comes in. */
export const ADMIN_KEY_HEADER = 'x-admin-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Admin routes: the `X-Admin-Key` header must equal `ADMIN_API_KEY`. Compared
 * through SHA-256 digests in constant time, so neither the content nor the
 * length leaks through timing. With no key configured the routes do not exist
 * (404), rather than being open.
 *
 * Separate from the visitors' OAuth tokens on purpose: any visitor gets one,
 * so a token can never be what lets someone hide a player.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor(config: ConfigService<Env, true>) {
    const key = config.get('ADMIN_API_KEY', { infer: true });
    this.expected = key ? digest(key) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) throw new NotFoundException();

    const given = context.switchToHttp().getRequest<Request>().get(ADMIN_KEY_HEADER);
    if (!given || !timingSafeEqual(digest(given), this.expected)) {
      throw new UnauthorizedException({ error: 'invalid_admin_key' });
    }

    return true;
  }
}
