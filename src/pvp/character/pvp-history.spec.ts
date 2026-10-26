import { describe, expect, it } from 'vitest';

import type { CharacterAchievementsPayload } from '../../blizzard/schemas/character-achievements.schema.js';
import { pvpHistoryOf, type HistorySeason } from './pvp-history.js';

type Achievement = CharacterAchievementsPayload['achievements'][number];

const earned = (id: number, name: string, at: string, mine = true): Achievement => ({
  id,
  achievement: { id, name },
  criteria: { is_completed: mine },
  completed_timestamp: Date.parse(at),
});

const season = (
  seasonId: number,
  startsAt: string,
  titles: { bracket: string; achievementId: number }[] = [],
): HistorySeason => {
  const cutoff = (achievementId: number) => ({
    rating: 3000,
    title: 'R1',
    achievementId,
    factions: null,
  });
  const core = (bracket: '2v2' | '3v3' | 'rbg') => {
    const title = titles.find((t) => t.bracket === bracket);
    return title ? cutoff(title.achievementId) : null;
  };
  const spec = (family: string) =>
    Object.fromEntries(
      titles
        .filter((t) => t.bracket.startsWith(`${family}-`))
        .map((t) => [
          t.bracket.slice(family.length + 1),
          { ...cutoff(t.achievementId), bracket: t.bracket, specialization: null },
        ]),
    );

  return {
    seasonId,
    startsAt,
    cutoffs: { '2v2': null, '3v3': core('3v3'), rbg: core('rbg') },
    specCutoffs: { shuffle: spec('shuffle'), blitz: spec('blitz') },
  };
};

// Seasons 39 (TWW 1) and 40 (TWW 2), as Rankwarden records them.
const SEASONS = [
  season(39, '2024-09-10T15:00:00Z', [
    { bracket: '3v3', achievementId: 40380 },
    { bracket: 'shuffle-mage-fire', achievementId: 40381 },
    { bracket: 'shuffle-paladin-holy', achievementId: 40381 },
  ]),
  season(40, '2025-02-25T15:00:00Z'),
];

const history = (...achievements: Achievement[]) => pvpHistoryOf({ achievements }, SEASONS);

describe('pvpHistoryOf', () => {
  it('reads seasonal tiers, divisions and expansions from their names', () => {
    const [rival, duelist] = history(
      earned(41017, 'Rival II: The War Within Season 2', '2025-03-05T10:00:00Z'),
      earned(40391, 'Duelist: The War Within Season 1', '2024-10-28T10:00:00Z'),
    );

    expect(rival).toMatchObject({
      tier: 'rival',
      division: 2,
      expansion: 'The War Within',
      seasonNumber: 2,
      seasonId: 40,
      bracket: null,
    });
    expect(duelist).toMatchObject({
      tier: 'duelist',
      division: null,
      seasonNumber: 1,
      seasonId: 39,
    });
  });

  it('names Rank 1 titles by the achievement ids Rankwarden recorded', () => {
    const [legend, gladiator] = history(
      earned(40380, 'Forged Gladiator: The War Within Season 1', '2025-03-11T10:00:00Z'),
      earned(40381, 'Forged Legend: The War Within Season 1', '2025-03-12T10:00:00Z'),
    );

    expect(gladiator).toMatchObject({ tier: 'rank-one', seasonId: 39, bracket: '3v3' });
    // Every Shuffle spec earns the same Legend title: the bracket is the family.
    expect(legend).toMatchObject({
      tier: 'rank-one',
      seasonId: 39,
      bracket: 'shuffle',
      expansion: 'The War Within',
      seasonNumber: 1,
    });
  });

  it('falls back to names for Rank 1 titles of seasons Rankwarden lacks', () => {
    const entries = history(
      earned(12945, 'Dread Gladiator: Battle for Azeroth Season 1', '2019-02-05T10:00:00Z'),
      earned(19455, 'Hero of the Alliance: Draconic', '2024-08-06T10:00:00Z'),
    );

    expect(entries.map(({ tier, seasonId, bracket }) => ({ tier, seasonId, bracket }))).toEqual([
      { tier: 'rank-one', seasonId: null, bracket: null },
      { tier: 'rank-one', seasonId: null, bracket: null },
    ]);
    expect(entries[1]).toMatchObject({ expansion: 'Battle for Azeroth', seasonNumber: 1 });
  });

  it('reads the older naming, with no season id before Rankwarden starts', () => {
    const entries = history(
      earned(8649, 'Challenger: Season 14', '2014-04-18T10:00:00Z'),
      earned(9240, 'Duelist: Warlords Season 1', '2015-07-07T10:00:00Z'),
      earned(11038, 'Gladiator: Legion Season 3', '2017-06-27T10:00:00Z'),
    );

    expect(
      entries.map(({ tier, expansion, seasonNumber, seasonId }) => [
        tier,
        expansion,
        seasonNumber,
        seasonId,
      ]),
    ).toEqual([
      ['gladiator', 'Legion', 3, null],
      ['duelist', 'Warlords', 1, null],
      ['challenger', null, 14, null],
    ]);
  });

  it('flags titles another character of the account earned', () => {
    const [entry] = history(
      earned(19490, 'Gladiator: Dragonflight Season 4', '2024-06-18T10:00:00Z', false),
    );

    expect(entry).toMatchObject({ tier: 'gladiator', earnedByThisCharacter: false });
  });

  it('ignores everything that is not a rated PvP title, and anything unearned', () => {
    const entries = history(
      earned(6897, 'Scholomance Challenger', '2014-05-08T10:00:00Z'),
      earned(8899, 'Challenge Warlord: Gold', '2015-11-04T10:00:00Z'),
      earned(11697, 'Cruel Elite', '2017-03-30T10:00:00Z'),
      earned(13449, 'Battle for Azeroth Keystone Master: Season Two', '2019-04-21T10:00:00Z'),
      earned(6942, 'Hero of the Alliance', '2024-08-09T10:00:00Z'),
      earned(2091, 'Gladiator', '2020-07-21T10:00:00Z'),
      { id: 62930, achievement: { id: 62930, name: 'Gladiator: Midnight Season 2' } },
    );

    expect(entries).toEqual([]);
  });

  it('lists the newest first', () => {
    const entries = history(
      earned(40391, 'Duelist: The War Within Season 1', '2024-10-28T10:00:00Z'),
      earned(41018, 'Duelist: The War Within Season 2', '2025-03-05T10:00:00Z'),
    );

    expect(entries.map((entry) => entry.achievementId)).toEqual([41018, 40391]);
  });
});
