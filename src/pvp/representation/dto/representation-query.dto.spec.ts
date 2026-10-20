import { REPRESENTATION_MIN_RATINGS } from '@denipetrov/spirit-link/constants';
import { describe, expect, it } from 'vitest';

import { representationQuerySchema } from './representation-query.dto.js';

const parse = (input: Record<string, unknown>) =>
  representationQuerySchema.safeParse({
    region: 'eu',
    bracket: '3v3',
    rating: '2100',
    date: '2026-10-20',
    ...input,
  });

describe('representationQuerySchema', () => {
  it('turns the query string into typed values, the date into UTC midnight', () => {
    expect(parse({ region: 'EU' }).data).toEqual({
      region: 'eu',
      bracket: '3v3',
      rating: 2100,
      date: new Date('2026-10-20T00:00:00.000Z'),
      getEarliestDate: false,
    });
    expect(parse({ getEarliestDate: 'true' }).data?.getEarliestDate).toBe(true);
  });

  it("accepts exactly spirit-link's tracked cutoffs", () => {
    for (const rating of REPRESENTATION_MIN_RATINGS) {
      expect(parse({ rating: String(rating) }).success).toBe(true);
    }
    expect(parse({ rating: '2000' }).success).toBe(false);
  });

  it('accepts "latest" for the date, in any case', () => {
    expect(parse({ date: 'latest' }).data?.date).toBe('latest');
    expect(parse({ date: 'Latest' }).data?.date).toBe('latest');
    expect(parse({ date: 'newest' }).success).toBe(false);
  });

  it('refuses a date that is not a calendar day, or not YYYY-MM-DD', () => {
    expect(parse({ date: '2026-02-30' }).success).toBe(false);
    expect(parse({ date: '20261020' }).success).toBe(false);
    expect(parse({ date: '2026-10-20T10:00' }).success).toBe(false);
  });

  it('refuses unknown brackets and regions, and a non-boolean flag', () => {
    expect(parse({ bracket: 'shuffle-mage-fire' }).success).toBe(false);
    expect(parse({ region: 'cn' }).success).toBe(false);
    expect(parse({ getEarliestDate: 'yes' }).success).toBe(false);
  });
});
