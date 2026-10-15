import type { NextFunction, Request, Response } from 'express';
import { RunLogger, withRunId } from '@denipetrov/spirit-link/logging';

import { RunKind } from './run-kind.js';

const logger = new RunLogger('Http');

/**
 * Runs each request under its own correlation id and logs it once it finishes.
 *
 * Successes are logged at `debug`: a front end makes many requests per visit,
 * and at `log` they would drown the lines that matter. A 5xx is a `warn`,
 * because it is something this service did wrong. The query string is left
 * out, since a refresh token may travel in a form body but never belongs in a
 * log line, and the path alone identifies the route.
 */
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  void withRunId(
    RunKind.Http,
    () =>
      new Promise<void>((resolve) => {
        const startedAt = Date.now();

        res.on('close', () => {
          const line = `${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`;

          if (res.statusCode >= 500) logger.warn(line);
          else logger.debug(line);

          resolve();
        });

        next();
      }),
  );
}
