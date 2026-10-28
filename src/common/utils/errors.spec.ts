import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { describeError, errorStack, zodIssues } from './errors.js';

const schema = z.object({
  season: z.object({ id: z.number().int() }),
  entries: z.array(z.object({ rating: z.number() })),
});

function zodErrorFor(payload: unknown): z.ZodError {
  const result = schema.safeParse(payload);
  if (result.success) throw new Error('expected the payload to fail validation');

  return result.error;
}

describe('describeError', () => {
  it('keeps a schema failure on one line', () => {
    // A ZodError message is a pretty-printed JSON array of every issue, so
    // interpolating it produces a multi-line block where a log record belongs,
    // and line-oriented shipping then splits it into unrelated entries.
    const message = describeError(zodErrorFor({ season: {}, entries: 'not-an-array' }));

    expect(message).not.toContain('\n');
  });

  it('names each failing path and its reason', () => {
    const message = describeError(zodErrorFor({ season: {}, entries: 'not-an-array' }));

    expect(message).toContain('season.id');
    expect(message).toContain('entries');
  });

  it('reports how many issues there were', () => {
    expect(describeError(zodErrorFor({ season: {}, entries: 'not-an-array' }))).toMatch(
      /^2 schema issues:/,
    );
  });

  it('passes an ordinary error message through unchanged', () => {
    expect(describeError(new Error('Blizzard API 500'))).toBe('Blizzard API 500');
  });

  it('handles a thrown non-error', () => {
    expect(describeError('just a string')).toBe('just a string');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('says what an empty-message AggregateError holds, as localhost refusing on ::1 and 127.0.0.1', () => {
    const refused = new AggregateError([
      new Error('connect ECONNREFUSED ::1:3000'),
      new Error('connect ECONNREFUSED 127.0.0.1:3000'),
    ]);

    expect(describeError(refused)).toBe(
      'connect ECONNREFUSED ::1:3000; connect ECONNREFUSED 127.0.0.1:3000',
    );
    // Wrapped once more with no message, as got does.
    expect(describeError(new Error('', { cause: refused }))).toContain('ECONNREFUSED ::1:3000');
  });

  it('falls back to the code, then the name, when there is nothing else', () => {
    expect(describeError(Object.assign(new Error(''), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
    expect(describeError(new TypeError(''))).toBe('TypeError');
  });
});

describe('zodIssues', () => {
  it('joins issues as path: message', () => {
    expect(zodIssues(zodErrorFor({ season: { id: 'x' }, entries: [] }))).toMatch(/season\.id: /);
  });

  it('labels a root-level issue rather than leaving the path blank', () => {
    expect(zodIssues(zodErrorFor(null))).toContain('(root)');
  });
});

describe('errorStack', () => {
  it('returns the stack, which is what Logger.error expects as a string', () => {
    const error = new Error('boom');

    expect(errorStack(error)).toBe(error.stack);
    expect(errorStack(error)).toContain('boom');
  });

  it('falls back to the message when a stack was never captured', () => {
    const error = new Error('no stack here');
    error.stack = undefined;

    expect(errorStack(error)).toBe('no stack here');
  });

  it('stringifies a thrown non-error', () => {
    expect(errorStack({ code: 42 })).toBe('[object Object]');
  });
});
