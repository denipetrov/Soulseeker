import { describe, expect, it } from 'vitest';

import { cutoffsQuerySchema } from './cutoffs-query.dto.js';

const parse = (input: Record<string, unknown>) => cutoffsQuerySchema.safeParse(input);

describe('cutoffsQuerySchema', () => {
  it('accepts the ladders that award a title, in any case', () => {
    for (const bracket of ['3v3', 'RBG', 'Shuffle', 'blitz']) {
      expect(parse({ region: 'EU', bracket }).success, bracket).toBe(true);
    }
    expect(parse({ region: 'eu', bracket: 'Shuffle' }).data).toEqual({
      region: 'eu',
      bracket: 'shuffle',
      class: null,
      spec: null,
      role: null,
      subRole: null,
    });
  });

  it('takes a role or sub-role, with a class or not, but a class alone still needs a spec', () => {
    expect(parse({ region: 'eu', bracket: 'shuffle', role: 'healer' }).success).toBe(true);
    expect(parse({ region: 'eu', bracket: '3v3', class: 'druid', role: 'dps' }).data).toMatchObject(
      { class: 'druid', spec: null, role: 'dps' },
    );
    expect(parse({ region: 'eu', bracket: 'shuffle', class: 'druid' }).success).toBe(false);
    expect(
      parse({ region: 'eu', bracket: 'shuffle', class: 'mage', spec: 'fire', subRole: 'ranged' })
        .success,
    ).toBe(false);
  });

  it('refuses 2v2, spec ladders, unknown regions and missing fields', () => {
    expect(parse({ region: 'eu', bracket: '2v2' }).success).toBe(false);
    expect(parse({ region: 'eu', bracket: 'shuffle-mage-fire' }).success).toBe(false);
    expect(parse({ region: 'cn', bracket: '3v3' }).success).toBe(false);
    expect(parse({ region: 'eu' }).success).toBe(false);
  });

  it('takes class and spec together, as slugs', () => {
    expect(
      parse({ region: 'eu', bracket: 'shuffle', class: 'Mage', spec: 'Fire' }).data,
    ).toMatchObject({
      class: 'mage',
      spec: 'fire',
    });
    expect(parse({ region: 'eu', bracket: 'shuffle', class: 'mage' }).success).toBe(false);
    expect(parse({ region: 'eu', bracket: 'shuffle', spec: 'fire' }).success).toBe(false);
    expect(parse({ region: 'eu', bracket: 'shuffle', class: 'bard', spec: 'fire' }).success).toBe(
      false,
    );
    expect(parse({ region: 'eu', bracket: 'shuffle', class: 'mage', spec: 'fi re' }).success).toBe(
      false,
    );
  });
});
