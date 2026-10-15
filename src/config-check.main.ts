import { validateEnv } from './config/env.schema.js';

/**
 * Validates the environment against the service's own schema and exits:
 * `npm run config:check`.
 *
 * For the deploy pipeline: a production value that fails validation is found
 * here, before anything is deployed, using the exact rules the service applies
 * at startup. Nothing is connected to and nothing is started.
 *
 * Prints variable names and what is wrong with them, never a value.
 */
try {
  const env = validateEnv(process.env);

  console.log(
    `Configuration is valid (NODE_ENV=${env.NODE_ENV}, issuer ${env.OIDC_ISSUER}, ` +
      `${env.CORS_ORIGINS.length} allowed origin(s)).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
