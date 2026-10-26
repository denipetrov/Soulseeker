import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type Provider from 'oidc-provider';

import { OIDC_MOUNT_PATH, OIDC_PROVIDER } from './auth/auth.constants.js';
import { requestLogging } from './common/logging/request-logging.middleware.js';
import type { Env } from './config/env.schema.js';
import { docsEnabled, DOCS_PATH, setupSwagger } from './docs/swagger.js';

/** Smaller than this, a response is sent as it is: compressing it would not pay. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/** Not compressed: probes gain nothing, and token answers are small and hold secrets. */
const UNCOMPRESSED_PATHS = ['/health', OIDC_MOUNT_PATH];

/**
 * Brotli for every client that accepts it, gzip for the rest, by
 * `Accept-Encoding`. Brotli runs at quality 4 (the library's default): on our
 * largest answer, an 850 KB boss kill, it makes 68 KB in ~3 ms, where gzip
 * makes 128 KB in ~8 ms. JSON shrinks 6–17×, as its keys repeat throughout.
 */
const responseCompression = compression({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  filter: (req, res) =>
    !UNCOMPRESSED_PATHS.some((path) => req.path === path || req.path.startsWith(`${path}/`)) &&
    compression.filter(req, res),
});

/**
 * Everything that has to be in front of Nest's own routing, in order. Shared by
 * `main.ts` and the integration harness, so the tests run the app as deployed.
 *
 * Must run before `init()`/`listen()`: Nest registers its body parsers there,
 * and the authorization server has to be mounted before them — oidc-provider
 * parses its own form bodies and refuses a stream someone else consumed.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<Env, true>);

  // The client address behind the gateway, for every per-IP limit.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.disable('x-powered-by');

  app.use(requestLogging);
  app.use(responseCompression);

  const docs = docsEnabled(config);
  const apiHeaders = helmet();
  // Swagger UI over plain http: helmet's default `upgrade-insecure-requests`
  // sends the browser to https://localhost for the UI's own scripts, and the
  // page stays blank. Everything else about the policy is kept.
  const docsHeaders = helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    docs && req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHeaders(req, res, next)
      : apiHeaders(req, res, next),
  );

  // Before CORS: oidc-provider answers its own CORS, per client, and a second
  // layer would send every header twice.
  const provider = app.get<Provider>(OIDC_PROVIDER);
  app.use(OIDC_MOUNT_PATH, provider.callback());

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST'],
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['retry-after', 'www-authenticate'],
    maxAge: 600,
  });

  // Not behind the API's guards: these are plain HTTP routes, not Nest
  // controllers. Off in production.
  if (docs) setupSwagger(app, config);

  app.enableShutdownHooks();
}
