import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createLocalJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { Env } from '../config/env.schema.js';
import { API_READ_SCOPE, SIGNING_ALG, SIGNING_KEYS } from './auth.constants.js';
import type { SigningKeys } from './oidc/signing-keys.js';
import { IS_PUBLIC } from './public.decorator.js';

/** What a verified access token says, attached to the request as `req.auth`. */
export interface AuthContext {
  /** `anon:<uuid>` today. */
  subject: string;
  scopes: Set<string>;
  tokenId: string | undefined;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * Every route needs an access token issued by this service's authorization
 * server, for this API, unexpired, with `api:read`.
 *
 * Verified locally against the public keys: no call to the token endpoint, no
 * Redis read, so it costs a signature check per request and survives a Redis
 * outage. The price is that a revoked grant's access tokens stay usable until
 * they expire, which `OIDC_ACCESS_TOKEN_TTL_SECONDS` keeps short.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly keys: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
    @Inject(SIGNING_KEYS) signingKeys: SigningKeys,
  ) {
    this.keys = createLocalJWKSet(signingKeys.publicJwks);
    this.issuer = config.get('OIDC_ISSUER', { infer: true });
    this.audience = config.get('OIDC_API_RESOURCE', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();

    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return this.refuse(res, 'invalid_request', 'access token required');
    }

    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: [SIGNING_ALG],
        typ: 'at+jwt',
      });

      const scopes = new Set(typeof payload.scope === 'string' ? payload.scope.split(' ') : []);
      if (!scopes.has(API_READ_SCOPE) || typeof payload.sub !== 'string') {
        return this.refuse(res, 'insufficient_scope', `${API_READ_SCOPE} required`);
      }

      req.auth = { subject: payload.sub, scopes, tokenId: payload.jti };
      return true;
    } catch {
      return this.refuse(res, 'invalid_token', 'access token invalid or expired');
    }
  }

  private refuse(res: Response, error: string, description: string): never {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer error="${error}", error_description="${description}"`,
    );
    throw new UnauthorizedException({ error, error_description: description });
  }
}
