import { describe, expect, it } from 'vitest';

import { leaderboardQuerySchema } from './leaderboard-query.dto.js';

const parse = (input: Record<string, unknown>) =>
  leaderboardQuerySchema.safeParse({ region: 'eu', seasonId: '42', ...input });

describe('leaderboardQuerySchema', () => {
  it('fills page defaults and coerces numbers from the query string', () => {
    expect(parse({ bracket: '3v3' }).data).toEqual({
      region: 'eu',
      seasonId: 42,
      bracket: '3v3',
      class: null,
      spec: null,
      page: 1,
      pageSize: 50,
    });
  });

  it('splits a full spec ladder name into family, class and spec', () => {
    expect(parse({ bracket: 'shuffle-hunter-beastmastery' }).data).toMatchObject({
      bracket: 'shuffle',
      class: 'hunter',
      spec: 'beastmastery',
    });
  });

  it('accepts a class without a spec, never a spec without a class', () => {
    expect(parse({ bracket: 'shuffle', class: 'Mage' }).data).toMatchObject({
      class: 'mage',
      spec: null,
    });
    expect(parse({ bracket: 'shuffle', spec: 'fire' }).success).toBe(false);
  });

  it('refuses a ladder that disagrees with the class and spec given', () => {
    expect(parse({ bracket: 'shuffle-mage-fire', class: 'warrior' }).success).toBe(false);
  });

  it('refuses unknown brackets, classes, regions and page sizes', () => {
    expect(parse({ bracket: '5v5' }).success).toBe(false);
    expect(parse({ bracket: 'shuffle-paladin' }).success).toBe(false);
    expect(parse({ bracket: '3v3', class: 'bard' }).success).toBe(false);
    expect(parse({ bracket: '3v3', region: 'cn' }).success).toBe(false);
    expect(parse({ bracket: '3v3', pageSize: '101' }).success).toBe(false);
    expect(parse({ bracket: '3v3', page: '0' }).success).toBe(false);
  });

  it('refuses a page past the deepest allowed row', () => {
    expect(parse({ bracket: 'shuffle', page: '5000', pageSize: '100' }).success).toBe(false);
  });
});
