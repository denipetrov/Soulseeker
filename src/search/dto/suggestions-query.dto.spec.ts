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
});
