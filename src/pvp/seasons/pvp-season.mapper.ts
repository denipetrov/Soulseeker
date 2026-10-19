import type { Region } from '../../blizzard/blizzard.constants.js';
import type {
  ArchiveSeasonDocument,
  SeasonReward,
  SeasonStateDocument,
} from '../entities/season.entity.js';
import {
  CORE_BRACKETS,
  SPEC_FAMILIES,
  type CoreBracket,
  type Cutoff,
  type Faction,
  type FactionCutoff,
  type PvpSeason,
  type PvpSeasonIndex,
  type PvpSeasonSummary,
  type SpecCutoff,
  type SpecFamily,
} from './pvp-season.types.js';

/** A ladder name split into what the cache is keyed by. */
export type BracketKey =
  { kind: 'core'; bracket: CoreBracket } | { kind: 'spec'; family: SpecFamily; spec: string };

/** `3v3` → core; `shuffle-mage-fire` → spec `mage-fire` of `shuffle`; anything else → null. */
export function parseBracket(bracket: string): BracketKey | null {
  if ((CORE_BRACKETS as readonly string[]).includes(bracket)) {
    return { kind: 'core', bracket: bracket as CoreBracket };
  }

  for (const family of SPEC_FAMILIES) {
    const prefix = `${family}-`;
    // `shuffle-overall` and `blitz-overall` are aggregates, never a spec.
    if (bracket.startsWith(prefix) && bracket !== `${family}-overall`) {
      const spec = bracket.slice(prefix.length);
      if (spec) return { kind: 'spec', family, spec };
    }
  }

  return null;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** The rewards of one ladder folded into one cutoff, per faction where Blizzard split it. */
export function cutoffFrom(rewards: readonly SeasonReward[]): Cutoff {
  const split = rewards.filter((reward) => reward.faction !== null);
  const ratings = unique(rewards.map((reward) => reward.ratingCutoff));
  const titles = unique(rewards.map((reward) => reward.title));
  const achievements = unique(rewards.map((reward) => reward.achievementId));

  let factions: Cutoff['factions'] = null;
  if (split.length > 0) {
    factions = {};
    for (const reward of split) {
      const side = reward.faction!.toLowerCase() as Faction;
      factions[side] = {
        rating: reward.ratingCutoff,
        title: reward.title,
        achievementId: reward.achievementId,
      } satisfies FactionCutoff;
    }
  }

  return {
    rating: ratings.length === 1 ? ratings[0]! : null,
    title: titles.length === 1 ? titles[0]! : null,
    achievementId: achievements.length === 1 ? achievements[0]! : null,
    factions,
  };
}

type SeasonSource = Pick<
  ArchiveSeasonDocument | SeasonStateDocument,
  'region' | 'seasonId' | 'name' | 'startsAt' | 'endsAt' | 'rewards' | 'rewardsFetchedAt'
>;

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** One season document, archived or live, in the shape the cache holds. */
export function seasonFrom(
  source: SeasonSource,
  flags: { current: boolean; final: boolean },
): PvpSeason {
  const byBracket = new Map<string, SeasonReward[]>();
  for (const reward of source.rewards ?? []) {
    const list = byBracket.get(reward.bracket) ?? [];
    list.push(reward);
    byBracket.set(reward.bracket, list);
  }

  const cutoffs: PvpSeason['cutoffs'] = { '2v2': null, '3v3': null, rbg: null };
  const specCutoffs: PvpSeason['specCutoffs'] = { shuffle: {}, blitz: {} };

  for (const [bracket, rewards] of byBracket) {
    const key = parseBracket(bracket);
    if (!key) continue;

    if (key.kind === 'core') {
      cutoffs[key.bracket] = cutoffFrom(rewards);
    } else {
      specCutoffs[key.family][key.spec] = {
        ...cutoffFrom(rewards),
        bracket,
        specialization: rewards[0]?.specialization ?? null,
      } satisfies SpecCutoff;
    }
  }

  return {
    region: source.region,
    seasonId: source.seasonId,
    name: source.name ?? null,
    startsAt: iso(source.startsAt),
    endsAt: iso(source.endsAt),
    current: flags.current,
    final: flags.final,
    rewardsFetchedAt: iso(source.rewardsFetchedAt),
    cutoffs,
    specCutoffs,
  };
}

/**
 * Every season of every region, from both collections.
 *
 * A season that is both live and archived — ended, archived, and not yet
 * replaced by the next one — is taken from the archive, whose cutoffs are the
 * final ones, and still marked current.
 */
export function buildSeasons(
  archived: readonly ArchiveSeasonDocument[],
  live: readonly SeasonStateDocument[],
): PvpSeason[] {
  const currentIds = new Map(live.map((state) => [state.region, state.seasonId]));
  const seasons = new Map<string, PvpSeason>();

  for (const doc of archived) {
    seasons.set(
      seasonKeyOf(doc.region, doc.seasonId),
      seasonFrom(doc, { current: currentIds.get(doc.region) === doc.seasonId, final: true }),
    );
  }

  for (const state of live) {
    const key = seasonKeyOf(state.region, state.seasonId);
    if (!seasons.has(key)) seasons.set(key, seasonFrom(state, { current: true, final: false }));
  }

  return [...seasons.values()];
}

/** The per-region lists, newest season first. */
export function indexOf(seasons: readonly PvpSeason[]): PvpSeasonIndex {
  const index: PvpSeasonIndex = {};

  for (const season of seasons) {
    const summary: PvpSeasonSummary = {
      seasonId: season.seasonId,
      name: season.name,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      current: season.current,
      final: season.final,
    };
    (index[season.region] ??= []).push(summary);
  }

  for (const list of Object.values(index)) list.sort((a, b) => b.seasonId - a.seasonId);

  return index;
}

export function seasonKeyOf(region: Region, seasonId: number): string {
  return `${region}:${seasonId}`;
}

/** The cutoff of one ladder of a season, by its ladder name, or null. */
export function cutoffOf(season: PvpSeason, bracket: string): Cutoff | SpecCutoff | null {
  const key = parseBracket(bracket);
  if (!key) return null;

  return key.kind === 'core'
    ? season.cutoffs[key.bracket]
    : (season.specCutoffs[key.family][key.spec] ?? null);
}
