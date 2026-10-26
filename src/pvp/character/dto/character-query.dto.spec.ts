import { describe, expect, it } from 'vitest';

import { characterQuerySchema } from './character-query.dto.js';

const parse = (input: Record<string, unknown>) =>
  characterQuerySchema.safeParse({
    region: 'us',
    realmSlug: 'demon-soul',
    characterName: 'Manongauz',
    ...input,
  });

describe('characterQuerySchema', () => {
  it('normalises the identity and fills the defaults', () => {
    expect(parse({ region: 'US', realmSlug: ' Demon-Soul ' }).data).toEqual({
      region: 'us',
      realmSlug: 'demon-soul',
      characterName: 'manongauz',
      locale: 'en_US',
      forceRefresh: false,
    });
  });

  it('keeps accents in names and counts letters, not bytes', () => {
    expect(parse({ characterName: 'Gokǘü' }).data?.characterName).toBe('gokǘü');
    expect(parse({ characterName: 'Ëëëëëëëëëëëë' }).success).toBe(true);
  });

  it('requires region, realm and name', () => {
    const result = characterQuerySchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'region',
      'realmSlug',
      'characterName',
    ]);
  });

  it('refuses bad regions, realms, names, locales and flags', () => {
    expect(parse({ region: 'cn' }).success).toBe(false);
    expect(parse({ realmSlug: 'demon soul' }).success).toBe(false);
    expect(parse({ characterName: 'a' }).success).toBe(false);
    expect(parse({ characterName: 'Abcdefghijklm' }).success).toBe(false);
    expect(parse({ characterName: 'mano gauz' }).success).toBe(false);
    expect(parse({ locale: 'en_us' }).success).toBe(false);
    expect(parse({ forceRefresh: 'yes' }).success).toBe(false);
  });

  it('accepts every Blizzard locale and a forced refresh', () => {
    expect(parse({ locale: 'de_DE', forceRefresh: 'true' }).data).toMatchObject({
      locale: 'de_DE',
      forceRefresh: true,
    });
  });
});
