/**
 * The kinds of run that get their own correlation id.
 *
 * Soulseeker's own vocabulary. The correlation itself — `withRunId`,
 * `RunLogger`, `currentRunKind` — comes from `@denipetrov/spirit-link/logging`.
 * Every inbound HTTP request is one run, so every line it causes, down to an
 * upstream retry, carries the same `[http a1b2c3]` tag.
 */
export const RunKind = {
  Http: 'http',
  Sync: 'sync',
} as const;
export type RunKind = (typeof RunKind)[keyof typeof RunKind];
