import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type Provider from 'oidc-provider';

import { OIDC_MOUNT_PATH, OIDC_PROVIDER } from './auth/auth.constants.js';
import { requestLogging } from './common/logging/request-logging.middleware.js';
import type { Env } from './config/env.schema.js';

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
  app.use(helmet());

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

  app.enableShutdownHooks();
}
