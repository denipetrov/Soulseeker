import { describe, expect, it } from 'vitest';

import { guildQuerySchema } from './guild-query.dto.js';

const parse = (input: Record<string, unknown>) =>
  guildQuerySchema.safeParse({
    region: 'eu',
    realmSlug: 'tarren-mill',
    guildName: 'Echo',
    ...input,
  });

const issuesOf = (input: Record<string, unknown>) =>
  parse(input).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('guildQuerySchema', () => {
  it('normalises the identity and fills the defaults', () => {
    expect(parse({ region: 'EU', guildName: '  Method   Raid ' }).data).toEqual({
      region: 'eu',
      realmSlug: 'tarren-mill',
      guildName: 'method raid',
      showFullRoster: false,
      forceRefresh: false,
    });
  });

  it('requires region, realm slug and guild name', () => {
    expect(
      guildQuerySchema.safeParse({}).error?.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['region', 'realmSlug', 'guildName']);
  });

  it('accepts accents, apostrophes and hyphens in names, nothing else', () => {
    expect(parse({ guildName: "Les Fléaux d'Azeroth" }).success).toBe(true);
    expect(parse({ guildName: 'Echo-Prime' }).success).toBe(true);
    expect(parse({ guildName: 'Echo!' }).success).toBe(false);
    expect(parse({ guildName: 'E' }).success).toBe(false);
    expect(parse({ guildName: 'A'.repeat(25) }).success).toBe(false);
  });

  it('accepts each widget alone', () => {
    expect(parse({ showFullRoster: 'true' }).success).toBe(true);
    expect(parse({ raidEncounters: 'tier-mn-1', difficulty: 'Mythic' }).data).toMatchObject({
      raidEncounters: 'tier-mn-1',
      difficulty: 'mythic',
    });
    expect(
      parse({ raidEncounters: 'tier-mn-1', boss: 'midnight-falls', difficulty: 'heroic' }).success,
    ).toBe(true);
  });

  it('needs a difficulty with a raid, and a raid with a boss or a difficulty', () => {
    expect(issuesOf({ raidEncounters: 'tier-mn-1' })).toEqual([
      'difficulty: is required with raidEncounters or boss',
    ]);
    expect(issuesOf({ boss: 'midnight-falls', difficulty: 'mythic' })).toEqual([
      'boss: needs raidEncounters',
    ]);
    expect(issuesOf({ difficulty: 'mythic' })).toEqual(['difficulty: needs raidEncounters']);
  });

  it('refuses the roster combined with another widget, and difficulties Raider.io does not rank', () => {
    expect(
      issuesOf({ showFullRoster: 'true', raidEncounters: 'tier-mn-1', difficulty: 'mythic' }),
    ).toEqual(['showFullRoster: cannot be combined with raidEncounters: one widget per call']);
    expect(parse({ raidEncounters: 'tier-mn-1', difficulty: 'lfr' }).success).toBe(false);
  });
});
