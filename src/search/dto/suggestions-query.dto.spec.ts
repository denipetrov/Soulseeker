import { describe, expect, it } from 'vitest';

import { suggestionsQuerySchema } from './suggestions-query.dto.js';

const parse = (input: Record<string, unknown>) => suggestionsQuerySchema.safeParse(input);

describe('suggestionsQuerySchema', () => {
  it('accepts either spelling of the type', () => {
    expect(parse({ type: 'PvP', q: 'biba' }).data).toEqual({ type: 'pvp', q: 'biba' });
    expect(parse({ type: 'pve', q: 'biba' }).data).toEqual({ type: 'pve', q: 'biba' });
  });

  it('folds the query as Rankwarden folds searchName', () => {
    expect(parse({ type: 'pvp', q: 'Bìbà' }).data?.q).toBe('biba');
    expect(parse({ type: 'pvp', q: 'BIBA' }).data?.q).toBe('biba');
    expect(parse({ type: 'pvp', q: 'Ærøn' }).data?.q).toBe('aeron');
  });

  it('keeps scripts without accents searchable as typed', () => {
    expect(parse({ type: 'pvp', q: '흑마법' }).data?.q).toBe('흑마법');
    expect(parse({ type: 'pvp', q: 'Смерть' }).data?.q).toBe('смерть');
  });

  it('refuses an unknown type, a missing query, and a too-short one', () => {
    expect(parse({ type: 'raid', q: 'biba' }).success).toBe(false);
    expect(parse({ type: 'pvp' }).success).toBe(false);
    expect(parse({ type: 'pvp', q: 'b' }).success).toBe(false);
    // Two characters typed, one left after folding: still too short.
    expect(parse({ type: 'pvp', q: ' b ' }).success).toBe(false);
  });

  it('refuses a query longer than any name', () => {
    expect(parse({ type: 'pvp', q: 'x'.repeat(33) }).success).toBe(false);
  });

  it('refuses a short query that folding grows past the limit', () => {
    // One U+FDFA folds to eighteen characters.
    expect(parse({ type: 'pvp', q: 'ﷺﷺ' }).success).toBe(false);
  });

  it('accepts every kind of character real names use', () => {
    for (const q of [
      'Telegon-306757597',
      'Repugnant!',
      '***',
      'Bad Call',
      '!Whispers Of Ambition',
      '흑마법사',
      'Смерть',
      '月光',
      'Ærøn',
    ]) {
      expect(parse({ type: 'pve', q }).success, q).toBe(true);
    }
  });

  it('refuses anything a name cannot contain', () => {
    for (const q of [
      'bi\u0000ba', // NUL: MongoDB refuses it inside a regex
      'bi\nba', // control characters
      'bi​ba', // zero-width space
      'bi‮ba', // right-to-left override
      'bi\uD800ba', // a lone surrogate: broken UTF-16
      '<script>',
      '$where',
      '{"$ne":1}',
      '.*',
      'a|b',
      '(a+)+$',
      "biba'; drop",
    ]) {
      expect(parse({ type: 'pvp', q }).success, JSON.stringify(q)).toBe(false);
    }
  });

  it('never repeats the input in its error', () => {
    const result = parse({ type: 'pvp', q: '<script>alert(1)</script>' });

    expect(JSON.stringify(result.error?.issues)).not.toContain('script');
  });

  it('refuses operators and arrays in place of a string', () => {
    expect(parse({ type: 'pvp', q: { $ne: 'x' } }).success).toBe(false);
    expect(parse({ type: 'pvp', q: ['ab', 'cd'] }).success).toBe(false);
    expect(parse({ type: { $ne: 'x' }, q: 'biba' }).success).toBe(false);
  });
});
