import { describe, expect, it } from 'vitest';

import { characterSyncSchema } from '../../rankwarden/dto/character-sync.dto.js';
import {
  corePartOf,
  localizedPartOf,
  responseOf,
  syncPayloadOf,
  withoutLinks,
  type CoreFetch,
  type LocalizedFetch,
} from './character.mapper.js';

const LINK = { href: 'https://us.api.blizzard.com/data/wow/item/1?namespace=static-us' };

const CORE: CoreFetch = {
  media: {
    assets: [
      { key: 'avatar', value: 'https://render/avatar.jpg' },
      { key: 'main-raw', value: 'https://render/main-raw.png' },
    ],
  },
  summary: { brackets: [], honor_level: 1991, honorable_kills: 10516 },
  brackets: [
    {
      bracket: '3v3',
      payload: {
        bracket: { id: 1, type: 'ARENA_3v3' },
        rating: 2100,
        season: { id: 42 },
        season_match_statistics: { played: 10, won: 6, lost: 4 },
      },
    },
    {
      bracket: 'shuffle-paladin-holy',
      payload: {
        bracket: { id: 6, type: 'SHUFFLE' },
        rating: 2729,
        season: { id: 42 },
        season_match_statistics: { played: 29, won: 28, lost: 1 },
        season_round_statistics: { played: 160, won: 95, lost: 65 },
        specialization: { id: 65, name: 'Holy' },
      },
    },
  ],
  statistics: {
    speed: { rating_bonus: 8.5, rating_normalized: 98 },
    mastery: { value: 64.9, rating_bonus: 39.4, rating_normalized: 1208 },
    versatility: 1281,
    versatility_damage_done_bonus: 23.7,
  },
  // As Blizzard nests them: ids 370 / 595 / 596 are the highest 2v2 / 3v3 / 5v5 ratings.
  achievementStatistics: {
    categories: [
      {
        statistics: [{ id: 1, quantity: 5 }],
        sub_categories: [
          {
            statistics: [
              { id: 370, quantity: 2923 },
              { id: 595, quantity: 3486 },
              { id: 596, quantity: 0 },
              // A team rating never set, as Blizzard reports it.
              { id: 374, quantity: 4294967294 },
            ],
          },
        ],
      },
    ],
  },
  pvpHistory: [],
};

const LOCALIZED: LocalizedFetch = {
  profile: {
    id: 203724421,
    name: 'Manongauz',
    level: 90,
    race: { id: 1, name: 'Human' },
    character_class: { id: 2, name: 'Paladin' },
    active_spec: { id: 65, name: 'Holy' },
    faction: { type: 'ALLIANCE', name: 'Alliance' },
    gender: { type: 'FEMALE', name: 'Female' },
    guild: { id: 91360489, name: 'veow' },
    realm: { id: 1286, name: 'Demon Soul', slug: 'demon-soul' },
    active_title: {
      id: 411,
      name: 'Corrupted Gladiator',
      display_string: 'Corrupted Gladiator {name}',
    },
    average_item_level: 306,
    equipped_item_level: 291,
    last_login_timestamp: Date.parse('2026-10-20T18:04:42Z'),
  },
  specializations: {
    active_specialization: { id: 65, name: 'Holy' },
    active_hero_talent_tree: { id: 49, name: 'Lightsmith' },
    specializations: [
      {
        specialization: { id: 65, name: 'Holy' },
        pvp_talent_slots: [
          { slot_number: 2, selected: { talent: { id: 640, name: 'Divine Vision' }, key: LINK } },
        ],
        loadouts: [
          { is_active: false, talent_loadout_code: 'OLD' },
          {
            is_active: true,
            talent_loadout_code: 'CODE',
            selected_hero_talent_tree: { id: 49, name: 'Lightsmith' },
            selected_class_talents: [
              { id: 1, rank: 1, tooltip: { talent: { id: 2, name: 'T', key: LINK } } },
            ],
          },
        ],
      },
      { specialization: { id: 66, name: 'Protection' }, loadouts: [] },
    ],
  },
  equipment: {
    equipped_items: [
      {
        item: { id: 271465 },
        slot: { type: 'HEAD', name: 'Head' },
        transmog: { item: { key: LINK, id: 194748 } },
      },
    ],
    equipped_item_sets: [],
  },
};

const NOW = new Date('2026-10-21T09:00:00Z');
const core = corePartOf(CORE, NOW);
const english = localizedPartOf(LOCALIZED, 'en_US', NOW);

describe('withoutLinks', () => {
  it('drops API links at any depth and keeps every other key, `key` strings included', () => {
    expect(
      withoutLinks({
        _links: { self: LINK },
        key: 'main-raw',
        item: { key: LINK, id: 1 },
        list: [{ key: LINK }],
      }),
    ).toEqual({ key: 'main-raw', item: { id: 1 }, list: [{}] });
  });
});

describe('the response', () => {
  it('joins the two parts, with ratings, stats and talents shaped for the page', () => {
    const response = responseOf('us', core, english, false);

    expect(response).toMatchObject({
      seasonId: 42,
      locale: 'en_US',
      character: { faction: 'alliance', gender: { type: 'female', name: 'Female' } },
      media: { avatar: 'https://render/avatar.jpg', mainRaw: 'https://render/main-raw.png' },
      honor: { level: 1991, honorableKills: 10516 },
      statistics: {
        // Speed has no `value`: its rating bonus is the whole of it.
        speed: { value: 8.5, rating: 98 },
        mastery: { value: 64.9, rating: 1208 },
        avoidance: null,
        versatility: 1281,
        versatilityDamageDoneBonus: 23.7,
      },
      // 5v5 never played (0); team ratings are never read.
      highestRatings: { '2v2': 2923, '3v3': 3486, '5v5': null },
      stale: false,
    });
    expect(response.brackets[1]).toEqual({
      bracket: 'shuffle-paladin-holy',
      rating: 2729,
      played: 29,
      won: 28,
      lost: 1,
      specialization: { id: 65, name: 'Holy' },
      rounds: { played: 160, won: 95, lost: 65 },
      // Rank and previous rating are read from Rankwarden per answer, never cached.
      rank: null,
      previousRating: null,
    });
    expect(response.brackets[0]).toMatchObject({ bracket: '3v3', rounds: null });
    expect(response.specializations?.specializations).toEqual([
      {
        specialization: { id: 65, name: 'Holy' },
        pvpTalentSlots: [
          { slotNumber: 2, selected: { talent: { id: 640, name: 'Divine Vision' } } },
        ],
        loadout: {
          talentLoadoutCode: 'CODE',
          heroTalentTree: { id: 49, name: 'Lightsmith' },
          classTalents: [{ id: 1, rank: 1, tooltip: { talent: { id: 2, name: 'T' } } }],
          specTalents: [],
          heroTalents: [],
        },
      },
      { specialization: { id: 66, name: 'Protection' }, pvpTalentSlots: [], loadout: null },
    ]);
    expect(response.equipment?.items).toEqual([
      {
        item: { id: 271465 },
        slot: { type: 'HEAD', name: 'Head' },
        transmog: { item: { id: 194748 } },
      },
    ]);
  });

  it('dates the page by its older part', () => {
    const older = corePartOf(CORE, new Date('2026-10-21T07:00:00Z'));

    expect(responseOf('us', older, english, true)).toMatchObject({
      fetchedAt: '2026-10-21T07:00:00.000Z',
      stale: true,
    });
  });
});

describe('the Rankwarden sync payload', () => {
  it('carries every ladder without a rank, and the English profile as Rankwarden stores it', () => {
    const payload = syncPayloadOf('us', core, english);

    expect(characterSyncSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      seasonId: 42,
      region: 'us',
      characterId: 203724421,
      realmId: 1286,
      realmSlug: 'demon-soul',
      faction: 'ALLIANCE',
      profile: {
        gender: 'FEMALE',
        realmName: 'Demon Soul',
        title: 'Corrupted Gladiator {name}',
        heroTalentTree: { id: 49, name: 'Lightsmith' },
        talentLoadouts: [
          {
            spec: { id: 65, name: 'Holy' },
            talentLoadoutCode: 'CODE',
            heroTalentTree: { id: 49, name: 'Lightsmith' },
          },
        ],
      },
    });
    expect(Object.keys(payload!.brackets)).toEqual(['3v3', 'shuffle-paladin-holy']);
    expect(payload!.brackets['3v3']).not.toHaveProperty('rank');
    expect(payload!.brackets['3v3']).toMatchObject({ played: 10, won: 6, lost: 4 });
    // Solo Shuffle goes as rounds, which is what Rankwarden's sweep stores.
    expect(payload!.brackets['shuffle-paladin-holy']).toMatchObject({
      played: 160,
      won: 95,
      lost: 65,
    });
  });

  it('leaves translated names out', () => {
    const german = localizedPartOf(LOCALIZED, 'de_DE', NOW);

    expect(syncPayloadOf('us', core, german)).not.toHaveProperty('profile');
  });

  it('sends nothing for a character with no rating this season', () => {
    const unrated = corePartOf({ ...CORE, brackets: [] }, NOW);

    expect(syncPayloadOf('us', unrated, english)).toBeNull();
  });
});
