import { describe, expect, it } from 'vitest';

import { anonymizeRaiderIoRoster, isHiddenMember, realmSlugOf } from './anonymize.js';
import { HiddenSet } from './hidden-list.service.js';

// A roster entry, loosely: the assertions check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const hidden = new HiddenSet({
  characters: ['eu/tarren-mill/grøäx', 'us/malganis/bondd'],
  guilds: [7],
});

describe('anonymizeRaiderIoRoster', () => {
  const entry = (name: string, realm: string, region: string) => ({
    character: {
      id: 123,
      name,
      class: { name: 'Shaman' },
      spec: { name: 'Elemental' },
      realm: { slug: realm, name: 'Realm' },
      region: { slug: region },
      path: `/characters/${region}/${realm}/${name}`,
      talentLoadout: { loadout_text: 'CODE' },
    },
    guild: { id: 9, name: 'Rain' },
    ranks: { score: 400 },
    oldCharacter: { name: 'Old' },
    role: 'dps',
    items: { item_level_equipped: 300 },
  });

  it("keeps a hidden player's slot, class, spec, talents, role and items; drops who they are", () => {
    const [hiddenOne, shown] = anonymizeRaiderIoRoster(
      [entry('Grøäx', 'tarren-mill', 'eu'), entry('Visible', 'tarren-mill', 'eu')],
      hidden,
    ) as Json[];

    expect(hiddenOne).toEqual({
      guild: null,
      role: 'dps',
      items: { item_level_equipped: 300 },
      character: {
        id: 0,
        name: 'Anonymous',
        class: { name: 'Shaman' },
        race: undefined,
        faction: undefined,
        level: undefined,
        spec: { name: 'Elemental' },
        talentLoadout: { loadout_text: 'CODE' },
        realm: { slug: 'anonymous', name: 'Anonymous' },
        region: { slug: 'eu' },
        path: null,
        anonymized: true,
      },
    });
    expect(shown).toEqual(entry('Visible', 'tarren-mill', 'eu'));
  });

  it("matches any case or composition of the name, and the caller's region when none is given", () => {
    const decomposed = 'GRØÄX'.normalize('NFD');
    const noRegion = { character: { name: decomposed, realm: { slug: 'tarren-mill' } } };

    expect((anonymizeRaiderIoRoster([noRegion], hidden, 'eu')[0] as Json).character.name).toBe(
      'Anonymous',
    );
    expect(anonymizeRaiderIoRoster([noRegion], hidden, 'us')[0]).toEqual(noRegion);
  });
});

describe('isHiddenMember', () => {
  it("reads the realm slug from the member's profile url, else from the realm's name", () => {
    expect(
      isHiddenMember(
        {
          rank: 3,
          character: {
            name: 'Bondd',
            realm: "Mal'Ganis",
            profile_url: 'https://raider.io/characters/us/malganis/Bondd',
          },
        },
        hidden,
        'eu',
      ),
    ).toBe(true);
    expect(
      isHiddenMember({ rank: 3, character: { name: 'Grøäx', realm: 'Tarren Mill' } }, hidden, 'eu'),
    ).toBe(true);
    expect(
      isHiddenMember({ rank: 3, character: { name: 'Grøäx', realm: 'Silvermoon' } }, hidden, 'eu'),
    ).toBe(false);
  });

  it("turns realm names into Blizzard's slugs", () => {
    expect(realmSlugOf('Tarren Mill')).toBe('tarren-mill');
    expect(realmSlugOf("Mal'Ganis")).toBe('malganis');
    expect(realmSlugOf('Aggra (Português)')).toBe('aggra-portugues');
    expect(realmSlugOf('Azjol-Nerub')).toBe('azjolnerub');
    expect(realmSlugOf('Area 52')).toBe('area-52');
  });
});

describe('HiddenSet', () => {
  it('lists keys by region and answers guilds by id', () => {
    expect(hidden.characterKeys(['us'])).toEqual(['us/malganis/bondd']);
    expect(hidden.characterKeys()).toHaveLength(2);
    expect(hidden.isGuildHidden(7)).toBe(true);
    expect(hidden.isGuildHidden(null)).toBe(false);
  });
});
