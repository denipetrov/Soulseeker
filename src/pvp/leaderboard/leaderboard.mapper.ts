import type {
  ArchiveEntry,
  CharacterDocument,
  RatingRow,
} from '../../characters/entities/character.entity.js';
import { cutoffOf } from '../seasons/pvp-season.mapper.js';
import type { Cutoff, Faction, PvpSeason } from '../seasons/pvp-season.types.js';
import type { LeaderboardEntry } from './leaderboard.types.js';

/** The character fields a leaderboard row is enriched with. */
export type BoardCharacter = Pick<
  CharacterDocument,
  | 'characterId'
  | 'characterName'
  | 'realmSlug'
  | 'faction'
  | 'brackets'
  | 'profileStatus'
  | 'profile'
>;

/**
 * Whether `rating` reaches a title cutoff.
 *
 * Where Blizzard set one cutoff per faction and they differ (3v3 and RBG up to
 * season 33) the character's own faction decides, and an unknown faction is
 * not in range. No cutoff at all — 2v2, or a season with no rewards recorded —
 * is not in range either.
 */
export function inTitleRange(
  rating: number,
  cutoff: Cutoff | null,
  faction: string | null,
): boolean {
  if (!cutoff) return false;
  if (cutoff.rating !== null) return rating >= cutoff.rating;

  const side = faction?.toLowerCase() as Faction | undefined;
  const own = side ? cutoff.factions?.[side] : undefined;

  return own ? rating >= own.rating : false;
}

/** `Beast Mastery` → `beastmastery`, the form ladder names and ratings rows use. */
export function slugOf(name: string | null | undefined): string | null {
  if (!name) return null;

  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

/**
 * The hero talent tree a character plays on one ladder.
 *
 * On a spec ladder it is the loadout of that spec, never the active spec's
 * tree: a Fury warrior's tree says nothing about their Arms ladder (Rankwarden
 * handbook, "Rules for readers"). On 2v2, 3v3 and RBG, which are not per spec,
 * it is the active spec's.
 */
export function heroTalentsFor(
  character: BoardCharacter | undefined,
  spec: string | null,
  perSpec: boolean,
): string | null {
  const profile = character?.profile;
  if (!profile) return null;

  if (!perSpec) return profile.heroTalentTree?.name ?? null;

  const loadout = profile.talentLoadouts?.find((entry) => slugOf(entry.spec?.name) === spec);

  return loadout?.heroTalentTree?.name ?? null;
}

const lower = (value: string | null | undefined): string | null =>
  value ? value.toLowerCase() : null;

/** A live ratings row, enriched with what `characters` holds of its character. */
export function currentEntry(
  row: Pick<RatingRow, 'characterId' | 'bracket' | 'rating' | 'class' | 'spec'>,
  character: BoardCharacter | undefined,
  season: PvpSeason | null,
): LeaderboardEntry {
  const standing = character?.brackets?.[row.bracket];
  const profile = character?.profile;
  const perSpec = row.bracket.includes('-');
  const faction = lower(character?.faction);

  // On a spec ladder the row's spec is the ladder's; elsewhere it is the
  // active spec, which the row only has once the character is enriched.
  const cls = row.class ?? slugOf(profile?.class?.name);
  const spec = row.spec ?? (perSpec ? null : slugOf(profile?.spec?.name));

  return {
    characterId: row.characterId,
    characterName: character?.characterName ?? null,
    realmSlug: character?.realmSlug ?? null,
    bracket: row.bracket,
    rating: row.rating,
    rank: standing?.rank ?? null,
    played: standing?.played ?? null,
    won: standing?.won ?? null,
    lost: standing?.lost ?? null,
    faction,
    inTitleRange: inTitleRange(row.rating, season ? cutoffOf(season, row.bracket) : null, faction),
    previousRating: standing?.previousRating ?? null,
    class: cls,
    spec,
    gender: lower(profile?.gender),
    heroTalents: heroTalentsFor(character, spec, perSpec),
    level: profile?.level ?? null,
    profileStatus: character?.profileStatus ?? null,
    race: profile?.race?.name ?? null,
  };
}

/** An archived standing: self-contained, so nothing to enrich, and no profile. */
export function archivedEntry(entry: ArchiveEntry, season: PvpSeason | null): LeaderboardEntry {
  const faction = lower(entry.faction);

  return {
    characterId: entry.characterId,
    characterName: entry.characterName ?? null,
    realmSlug: entry.realmSlug ?? null,
    bracket: entry.bracket,
    rating: entry.rating,
    rank: entry.rank ?? null,
    played: entry.played ?? null,
    won: entry.won ?? null,
    lost: entry.lost ?? null,
    faction,
    inTitleRange: inTitleRange(
      entry.rating,
      season ? cutoffOf(season, entry.bracket) : null,
      faction,
    ),
  };
}
