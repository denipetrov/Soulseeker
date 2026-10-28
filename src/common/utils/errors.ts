import { ZodError } from 'zod';

/**
 * A single readable line for any thrown value.
 *
 * `ZodError.message` is a pretty-printed JSON array of every issue, so
 * interpolating it into a log line produces a multi-line block where one record
 * should be — and line-oriented log shipping then splits it into unrelated
 * entries. Zod issues are flattened to `path: message` instead, which is the
 * same shape `validateEnv` reports at boot.
 */
export function describeError(error: unknown): string {
  if (error instanceof ZodError) return `${error.issues.length} schema issues: ${zodIssues(error)}`;
  if (error instanceof Error) {
    if (error.message) return error.message;

    // A connection refused on every address a host resolves to — `localhost`
    // as both ::1 and 127.0.0.1 — arrives as an AggregateError with no message
    // of its own; got wraps it with none either. Say what the inner ones say.
    const inner = error instanceof AggregateError ? error.errors : [error.cause];
    const parts = inner.filter((part) => part !== undefined).map((part) => describeError(part));
    const code = (error as { code?: unknown }).code;

    return parts.filter(Boolean).join('; ') || (typeof code === 'string' ? code : error.name);
  }

  return String(error);
}

/** Flattens zod issues to `path: message`, joined by `; `. */
export function zodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * The stack for `Logger.error(message, stack?)`, whose second parameter is a
 * string. Passing an `Error` there loses the stack in the outermost handlers,
 * which are exactly the ones worth a stack.
 */
export function errorStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
