import { describe, expect, it } from 'vitest';

import type {
  ArchiveSeasonDocument,
  SeasonReward,
  SeasonStateDocument,
} from '../entities/season.entity.js';
import { buildSeasons, cutoffOf, indexOf, parseBracket, seasonFrom } from './pvp-season.mapper.js';

const reward = (
  bracket: string,
  ratingCutoff: number,
  extra: Partial<SeasonReward> = {},
): SeasonReward => ({
  bracket,
  faction: null,
  ratingCutoff,
  title: `${bracket} title`,
  achievementId: 1,
  specialization: null,
  ...extra,
});

/** A modern season: shared 3v3, faction-split RBG and Blitz with equal ratings, Shuffle per spec. */
const MODERN: SeasonReward[] = [
  reward('3v3', 2858, { title: 'Venomous Gladiator', achievementId: 62922 }),
  reward('rbg', 2400, { faction: 'ALLIANCE', title: 'Hero of the Alliance', achievementId: 1 }),
  reward('rbg', 2400, { faction: 'HORDE', title: 'Hero of the Horde', achievementId: 2 }),
  reward('shuffle-mage-fire', 2492, { specialization: { id: 63, name: 'Fire' } }),
  reward('shuffle-deathknight-blood', 1584, { specialization: { id: 250, name: 'Blood' } }),
  reward('blitz-deathknight-blood', 2056, {
    faction: 'ALLIANCE',
    title: 'Venomous Marshal',
    specialization: { id: 250, name: 'Blood' },
  }),
  reward('blitz-deathknight-blood', 2056, {
    faction: 'HORDE',
    title: 'Venomous Warlord',
    specialization: { id: 250, name: 'Blood' },
  }),
];

const archive = (
  region: 'us' | 'eu',
  seasonId: number,
  rewards: SeasonReward[] = MODERN,
): ArchiveSeasonDocument => ({
  region,
  seasonId,
  name: `Season ${seasonId}`,
  startsAt: new Date('2026-03-18T04:00:00Z'),
  endsAt: new Date('2026-08-11T20:00:00Z'),
  archivedAt: new Date(),
  rewards,
  rewardsFetchedAt: new Date('2026-10-14T14:43:03Z'),
});

const live = (region: 'us' | 'eu', seasonId: number, rewards = MODERN): SeasonStateDocument => ({
  region,
  seasonId,
  name: `Season ${seasonId}`,
  startsAt: new Date('2026-08-18T15:00:00Z'),
  endsAt: null,
  lastCompletedSeasonId: null,
  observedAt: new Date(),
  rewards,
});

describe('parseBracket', () => {
  it('tells core ladders from per-spec ones', () => {
    expect(parseBracket('3v3')).toEqual({ kind: 'core', bracket: '3v3' });
    expect(parseBracket('shuffle-mage-fire')).toEqual({
      kind: 'spec',
      family: 'shuffle',
      spec: 'mage-fire',
    });
    expect(parseBracket('blitz-hunter-beastmastery')).toMatchObject({
      spec: 'hunter-beastmastery',
    });
  });

  it('refuses aggregates and unknown names', () => {
    expect(parseBracket('shuffle-overall')).toBeNull();
    expect(parseBracket('shuffle-')).toBeNull();
    expect(parseBracket('5v5')).toBeNull();
  });
});

describe('seasonFrom', () => {
  const season = seasonFrom(archive('eu', 41), { current: false, final: true });

  it('keeps one cutoff for 3v3, and none for 2v2', () => {
    expect(season.cutoffs['3v3']).toEqual({
      rating: 2858,
      title: 'Venomous Gladiator',
      achievementId: 62922,
      factions: null,
    });
    expect(season.cutoffs['2v2']).toBeNull();
  });

  it('keeps RBG as one rating with both faction titles', () => {
    expect(season.cutoffs.rbg).toEqual({
      rating: 2400,
      title: null,
      achievementId: null,
      factions: {
        alliance: { rating: 2400, title: 'Hero of the Alliance', achievementId: 1 },
        horde: { rating: 2400, title: 'Hero of the Horde', achievementId: 2 },
      },
    });
  });

  it('keys per-spec cutoffs by the ladder name without its family', () => {
    expect(Object.keys(season.specCutoffs.shuffle).sort()).toEqual([
      'deathknight-blood',
      'mage-fire',
    ]);
    expect(season.specCutoffs.shuffle['mage-fire']).toMatchObject({
      bracket: 'shuffle-mage-fire',
      rating: 2492,
      specialization: { id: 63, name: 'Fire' },
      factions: null,
    });
    expect(season.specCutoffs.blitz['deathknight-blood']).toMatchObject({
      rating: 2056,
      factions: { alliance: { title: 'Venomous Marshal' }, horde: { title: 'Venomous Warlord' } },
    });
  });

  it('leaves the shared rating null when old seasons set one per faction', () => {
    const old = seasonFrom(
      archive('us', 28, [
        reward('3v3', 2953, { faction: 'ALLIANCE', title: 'Notorious Gladiator' }),
        reward('3v3', 3071, { faction: 'HORDE', title: 'Notorious Gladiator' }),
      ]),
      { current: false, final: true },
    );

    expect(old.cutoffs['3v3']).toMatchObject({
      rating: null,
      title: 'Notorious Gladiator',
      factions: { alliance: { rating: 2953 }, horde: { rating: 3071 } },
    });
    expect(old.specCutoffs.shuffle).toEqual({});
  });

  it('answers nulls and empty maps for a season with no rewards', () => {
    const empty = seasonFrom(
      { ...archive('eu', 37), rewards: undefined },
      {
        current: false,
        final: true,
      },
    );

    expect(empty.cutoffs).toEqual({ '2v2': null, '3v3': null, rbg: null });
    expect(empty.specCutoffs).toEqual({ shuffle: {}, blitz: {} });
  });

  it('dates are ISO strings, ready for JSON', () => {
    expect(season.startsAt).toBe('2026-03-18T04:00:00.000Z');
    expect(seasonFrom(live('eu', 42), { current: true, final: false }).endsAt).toBeNull();
  });
});

describe('buildSeasons and indexOf', () => {
  it('marks the live season current, and prefers the archive when both hold it', () => {
    const seasons = buildSeasons(
      [archive('eu', 41), archive('eu', 42, [reward('3v3', 3000)])],
      [live('eu', 42, [reward('3v3', 2900)]), live('us', 42)],
    );

    const eu42 = seasons.find((s) => s.region === 'eu' && s.seasonId === 42)!;
    expect(eu42).toMatchObject({ current: true, final: true });
    expect(eu42.cutoffs['3v3']?.rating).toBe(3000);

    expect(seasons.find((s) => s.region === 'us')).toMatchObject({ current: true, final: false });
    expect(seasons.find((s) => s.seasonId === 41)).toMatchObject({ current: false });
  });

  it('lists each region newest first', () => {
    const index = indexOf(buildSeasons([archive('eu', 40), archive('eu', 41)], [live('eu', 42)]));

    expect(index.eu?.map((s) => s.seasonId)).toEqual([42, 41, 40]);
    expect(index.eu?.[0]).toMatchObject({ current: true, final: false });
  });
});

describe('cutoffOf', () => {
  const season = seasonFrom(archive('eu', 41), { current: false, final: true });

  it('looks a cutoff up by the ladder name the leaderboards use', () => {
    expect(cutoffOf(season, '3v3')?.rating).toBe(2858);
    expect(cutoffOf(season, 'shuffle-mage-fire')?.rating).toBe(2492);
    expect(cutoffOf(season, 'blitz-deathknight-blood')?.rating).toBe(2056);
  });

  it('is null for 2v2, an unknown spec or an unknown ladder', () => {
    expect(cutoffOf(season, '2v2')).toBeNull();
    expect(cutoffOf(season, 'shuffle-priest-holy')).toBeNull();
    expect(cutoffOf(season, 'nonsense')).toBeNull();
  });
});
