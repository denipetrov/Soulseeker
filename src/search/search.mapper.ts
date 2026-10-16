import type { CharacterDocument } from '../characters/entities/character.entity.js';
import type { GuildDocument } from '../characters/entities/guild.entity.js';
import type { MplusCharacterDocument } from '../characters/entities/mplus-character.entity.js';
import type { CharacterSuggestion, GuildSuggestion } from './search.types.js';

/** The fields a suggestion needs, and nothing else: talent loadouts are kilobytes each. */
export const PVP_CHARACTER_PROJECTION = {
  _id: 0,
  characterName: 1,
  region: 1,
  realmSlug: 1,
  faction: 1,
  'profile.realmName': 1,
  'profile.class.name': 1,
  'profile.spec.name': 1,
  'profile.heroTalentTree.name': 1,
  'profile.race.name': 1,
} as const;

export const MPLUS_CHARACTER_PROJECTION = {
  _id: 0,
  characterName: 1,
  region: 1,
  realmSlug: 1,
  realmName: 1,
  faction: 1,
  'profile.className': 1,
  'profile.specName': 1,
  'profile.raceName': 1,
} as const;

export const GUILD_PROJECTION = { _id: 0, name: 1, region: 1, realm: 1 } as const;

/** PvP stores `ALLIANCE`, Raider.io `alliance`: one spelling for the front end. */
function faction(value: string | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

export function pvpCharacterSuggestion(
  doc: Pick<CharacterDocument, 'characterName' | 'region' | 'realmSlug' | 'faction' | 'profile'>,
): CharacterSuggestion {
  const profile = doc.profile;

  return {
    characterName: doc.characterName,
    region: doc.region,
    realmSlug: doc.realmSlug,
    realmName: profile?.realmName ?? null,
    className: profile?.class?.name ?? null,
    specName: profile?.spec?.name ?? null,
    heroTalents: profile?.heroTalentTree?.name ?? null,
    raceName: profile?.race?.name ?? null,
    faction: faction(doc.faction),
  };
}

export function mplusCharacterSuggestion(
  doc: Pick<
    MplusCharacterDocument,
    'characterName' | 'region' | 'realmSlug' | 'realmName' | 'faction' | 'profile'
  >,
): CharacterSuggestion {
  return {
    characterName: doc.characterName,
    region: doc.region,
    realmSlug: doc.realmSlug,
    realmName: doc.realmName ?? null,
    className: doc.profile?.className ?? null,
    specName: doc.profile?.specName ?? null,
    heroTalents: null,
    raceName: doc.profile?.raceName ?? null,
    faction: faction(doc.faction),
  };
}

export function guildSuggestion(
  doc: Pick<GuildDocument, 'name' | 'region' | 'realm'>,
): GuildSuggestion {
  return {
    name: doc.name,
    region: doc.region,
    realmSlug: doc.realm.slug,
    realmName: doc.realm.name,
  };
}
