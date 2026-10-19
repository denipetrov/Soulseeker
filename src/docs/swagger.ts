import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { ANONYMOUS_GRANT_TYPE, OIDC_MOUNT_PATH } from '../auth/auth.constants.js';
import type { Env } from '../config/env.schema.js';

/** Where the UI is served; the document is at `/docs/openapi.json`. */
export const DOCS_PATH = 'docs';

/** The security scheme every protected route names. */
export const BEARER_AUTH = 'access-token';

/**
 * Whether the API docs are served: everywhere but production.
 *
 * Off in production on purpose. The docs map every route and parameter, and
 * the API's anonymous tokens exist to make scraping harder; publishing the
 * scraper's manual next to it would undo some of that.
 */
export function docsEnabled(config: ConfigService<Env, true>): boolean {
  return config.get('NODE_ENV', { infer: true }) !== 'production';
}

/**
 * Serves Swagger UI at `/docs`.
 *
 * The routes are documented from their decorators and zod schemas. The token
 * endpoint is not a Nest route — oidc-provider serves it — so it is added here
 * by hand, which is what lets "Try it out" obtain a token: run it, copy
 * `access_token`, paste it into "Authorize".
 */
export function setupSwagger(app: INestApplication, config: ConfigService<Env, true>): void {
  const clientId = config.get('OIDC_CLIENT_ID', { infer: true });

  const base = new DocumentBuilder()
    .setTitle('Soulseeker API')
    .setDescription(
      'Backend for the Rankwarden front end.\n\n' +
        '**Getting a token:** run `POST /oidc/token` below with the anonymous grant, copy ' +
        '`access_token`, then press **Authorize** and paste it. Tokens last ' +
        `${config.get('OIDC_ACCESS_TOKEN_TTL_SECONDS', { infer: true })} seconds.`,
    )
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH)
    .build();

  const document = SwaggerModule.createDocument(app, base);
  addTokenEndpoint(document, clientId);

  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    customSiteTitle: 'Soulseeker API',
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
  });
}

function addTokenEndpoint(document: OpenAPIObject, clientId: string): void {
  document.paths[`${OIDC_MOUNT_PATH}/token`] = {
    post: {
      tags: ['auth'],
      summary: 'Obtain or refresh an access token',
      description:
        'OAuth 2.0 token endpoint (oidc-provider). The anonymous grant starts a session; ' +
        '`refresh_token` rotates it, and replaying a used refresh token revokes the session. ' +
        'Limited per IP, and the `Origin` must be an allowed one — the docs page itself is ' +
        'allowed outside production.',
      requestBody: {
        required: true,
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              type: 'object',
              required: ['grant_type', 'client_id'],
              properties: {
                grant_type: {
                  type: 'string',
                  enum: [ANONYMOUS_GRANT_TYPE, 'refresh_token'],
                  default: ANONYMOUS_GRANT_TYPE,
                },
                client_id: { type: 'string', default: clientId },
                refresh_token: {
                  type: 'string',
                  description: 'With grant_type=refresh_token only.',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'A token pair.',
          content: {
            'application/json': {
              example: {
                access_token: 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9…',
                token_type: 'Bearer',
                expires_in: 600,
                refresh_token: 'm2Q8…',
                scope: 'api:read',
              },
            },
          },
        },
        '400': { description: '`invalid_grant`: unknown, expired or reused refresh token.' },
        '403': { description: '`access_denied`: the Origin is not allowed.' },
        '429': { description: '`too_many_requests`: too many new sessions from this address.' },
      },
    },
  };
}
