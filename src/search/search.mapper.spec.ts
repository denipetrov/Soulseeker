import { describe, expect, it } from 'vitest';

import type { CharacterDocument } from '../characters/entities/character.entity.js';
import { mplusCharacterSuggestion, pvpCharacterSuggestion } from './search.mapper.js';

describe('search mapper', () => {
  it('maps an enriched PvP character', () => {
    expect(
      pvpCharacterSuggestion({
        characterName: 'Davelol',
        region: 'us',
        realmSlug: 'emerald-dream',
        faction: 'ALLIANCE',
        profile: {
          realmName: 'Emerald Dream',
          class: { id: 6, name: 'Death Knight' },
          spec: { id: 252, name: 'Unholy' },
          heroTalentTree: { id: 31, name: "San'layn" },
          race: { id: 1, name: 'Human' },
        } as CharacterDocument['profile'],
      }),
    ).toEqual({
      characterName: 'Davelol',
      region: 'us',
      realmSlug: 'emerald-dream',
      realmName: 'Emerald Dream',
      className: 'Death Knight',
      specName: 'Unholy',
      heroTalents: "San'layn",
      raceName: 'Human',
      faction: 'alliance',
    });
  });

  it('answers nulls for a PvP character Rankwarden has not enriched yet', () => {
    expect(
      pvpCharacterSuggestion({
        characterName: 'Fresh',
        region: 'eu',
        realmSlug: 'kazzak',
        faction: null,
      }),
    ).toMatchObject({ className: null, specName: null, heroTalents: null, realmName: null });
  });

  it('never has hero talents for a Mythic+ character', () => {
    expect(
      mplusCharacterSuggestion({
        characterName: 'Bondd',
        region: 'us',
        realmSlug: 'illidan',
        realmName: 'Illidan',
        faction: 'alliance',
        profile: {
          classId: 7,
          className: 'Shaman',
          specId: 262,
          specName: 'Elemental',
          raceId: 3,
          raceName: 'Dwarf',
          level: 90,
          role: 'dps',
        },
      }),
    ).toMatchObject({ className: 'Shaman', specName: 'Elemental', heroTalents: null });
  });
});
