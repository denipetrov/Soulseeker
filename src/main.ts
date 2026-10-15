import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { logLevelsFor } from '@denipetrov/spirit-link/logging';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  app.useLogger(logLevelsFor(config.get('LOG_LEVEL', { infer: true })));
  configureApp(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  new Logger('Bootstrap').log(`Soulseeker listening on port ${port}`);
}

// A failed start is reported once, readably, and exits non-zero.
bootstrap().catch((error: unknown) => {
  // `console.error`, not the Nest logger: with `bufferLogs` on, a failure before
  // the logger is attached would leave this line in a buffer nobody flushes.
  console.error(
    `Soulseeker failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
