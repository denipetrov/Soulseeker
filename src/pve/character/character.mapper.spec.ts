import { describe, expect, it } from 'vitest';

import { raiderIoCharacterSchema } from '../../raiderio/schemas/character-profile.schema.js';
import { mplusCharacterSyncSchema } from '../../rankwarden/dto/mplus-character-sync.dto.js';
import {
  dungeonSlugOf,
  fullPartOf,
  raidPartOf,
  responseOf,
  roleOf,
  seasonPartOf,
  syncPayloadOf,
} from './character.mapper.js';

const RUN = {
  dungeon: 'Temple of Sethraliss',
  short_name: 'TOS',
  mythic_level: 14,
  completed_at: '2026-09-21T00:42:59.000Z',
  clear_time_ms: 1736151,
  keystone_run_id: 14738020,
  par_time_ms: 1920999,
  num_keystone_upgrades: 1,
  map_challenge_mode_id: 250,
  zone_id: 9527,
  zone_expansion_id: 7,
  icon_url: 'https://cdn/icon.jpg',
  background_image_url: 'https://cdn/background.jpg',
  score: 398.6,
  affixes: [
    {
      id: 10,
      name: 'Fortified',
      description: 'Non-boss enemies have 20% more health.',
      icon: 'ability_toughness',
      icon_url: 'https://cdn/ability_toughness.jpg',
      wowhead_url: 'https://wowhead.com/affix=10',
    },
  ],
  url: 'https://raider.io/mythic-plus-runs/season-mn-2/14738020-14-temple-of-sethraliss',
  spec: { id: 65, name: 'Holy', slug: 'holy', class_id: 2, role: 'healer' },
  role: 'healer',
};

/** A Raider.io answer with every field, trimmed from a real one; parsed as the client parses it. */
const PAYLOAD = raiderIoCharacterSchema.parse({
  name: 'Manongauz',
  race: 'Human',
  class: 'Paladin',
  active_spec_name: 'Holy',
  active_spec_role: 'HEALING',
  gender: 'female',
  faction: 'alliance',
  achievement_points: 39050,
  thumbnail_url: 'https://render/avatar.jpg',
  region: 'us',
  realm: 'Demon Soul',
  profile_banner: 'alliancebanner1',
  guild: { name: 'veow', realm: 'Demon Soul' },
  gear: {
    item_level_equipped: 291,
    item_level_total: 300,
    artifact_traits: 0,
    items: {
      head: {
        item_id: 271465,
        item_level: 308,
        enchant: 7991,
        icon: 'inv_helm',
        name: 'Warhelm',
        item_quality: 4,
        is_azerite_armor: true,
        azerite_powers: [null],
        gems: [240902],
        gems_detail: [{ id: 240902, name: '16 Mast & 7 Vers', icon: 'gem' }],
        enchants: [7991],
        enchants_detail: [{ id: 243981, name: 'Enchant Helm', icon: 'vellum' }],
        bonuses: [13452],
      },
    },
  },
  talentLoadout: { loadout_spec_id: 65, loadout_text: 'CODE', class_talents: [] },
  raid_progression: { 'tier-mn-1': { summary: '', total_bosses: 9, mythic_bosses_killed: 0 } },
  mythic_plus_scores_by_season: [
    {
      season: 'season-mn-2',
      scores: { all: 1760.9, healer: 1760.9 },
      segments: { all: { score: 1760.9, color: '#72ff56' } },
    },
  ],
  mythic_plus_ranks: { overall: { world: 1964157, region: 422278, realm: 928 } },
  mythic_plus_best_runs: [
    RUN,
    // A dungeon the season does not list.
    { ...RUN, zone_id: 1, keystone_run_id: 2, url: 'https://raider.io/x/season-mn-2/2-10-old' },
  ],
});

const NOW = new Date('2026-10-22T09:00:00Z');

describe('the whole page', () => {
  const response = responseOf('us', 'demon-soul', { full: fullPartOf(PAYLOAD, NOW) }, false);

  it('carries the base profile and every asked-for field', () => {
    expect(response).toMatchObject({
      region: 'us',
      realmSlug: 'demon-soul',
      character: {
        name: 'Manongauz',
        activeSpecName: 'Holy',
        gender: 'female',
        realm: 'Demon Soul',
        thumbnailUrl: 'https://render/avatar.jpg',
      },
      guild: { name: 'veow' },
      talentLoadout: { loadout_spec_id: 65, loadout_text: 'CODE', class_talents: [] },
      raidProgression: { 'tier-mn-1': { total_bosses: 9 } },
      mythicPlusRanks: { overall: { world: 1964157 } },
      fetchedAt: '2026-10-22T09:00:00.000Z',
      stale: false,
    });
    expect(response).not.toHaveProperty('raidAchievementCurve');
  });

  it('keeps only the gear fields the page renders', () => {
    expect(response.gear).toEqual({
      itemLevelEquipped: 291,
      items: {
        head: {
          item_id: 271465,
          item_level: 308,
          name: 'Warhelm',
          icon: 'inv_helm',
          bonuses: [13452],
          enchants_detail: [{ id: 243981, name: 'Enchant Helm', icon: 'vellum' }],
          gems_detail: [{ id: 240902, name: '16 Mast & 7 Vers', icon: 'gem' }],
        },
      },
    });
  });

  it('keeps scores without their colour segments', () => {
    expect(response.mythicPlusScores).toEqual([
      { season: 'season-mn-2', scores: { all: 1760.9, healer: 1760.9 } },
    ]);
  });

  it('trims runs: no ids or par time, affixes reduced to icon and link, spec to its id', () => {
    expect(response.mythicPlusBestRuns?.[0]).toEqual({
      dungeon: 'Temple of Sethraliss',
      mythic_level: 14,
      completed_at: '2026-09-21T00:42:59.000Z',
      clear_time_ms: 1736151,
      num_keystone_upgrades: 1,
      score: 398.6,
      icon_url: 'https://cdn/icon.jpg',
      background_image_url: 'https://cdn/background.jpg',
      url: RUN.url,
      affixes: [
        {
          id: 10,
          icon_url: 'https://cdn/ability_toughness.jpg',
          wowhead_url: 'https://wowhead.com/affix=10',
        },
      ],
      spec: { id: 65 },
      role: 'healer',
    });
  });
});

describe('a raid and a season', () => {
  it('answers with only those parts, dated by the older one', () => {
    const raid = raidPartOf(
      {
        ...PAYLOAD,
        raid_achievement_curve: [{ raid: 'tier-mn-1', aotc: '2026-04-22T01:53:00.000Z' }],
      },
      'tier-mn-1',
      new Date('2026-10-22T08:00:00Z'),
    );
    const season = seasonPartOf(PAYLOAD, NOW);

    const response = responseOf('us', 'demon-soul', { raid, season }, false);

    expect(response).toEqual({
      region: 'us',
      realmSlug: 'demon-soul',
      character: season.character,
      raidProgression: { 'tier-mn-1': { summary: '', total_bosses: 9, mythic_bosses_killed: 0 } },
      raidAchievementCurve: [{ raid: 'tier-mn-1', aotc: '2026-04-22T01:53:00.000Z' }],
      mythicPlusScores: [{ season: 'season-mn-2', scores: { all: 1760.9, healer: 1760.9 } }],
      fetchedAt: '2026-10-22T08:00:00.000Z',
      stale: false,
    });
  });

  it('answers an empty curve and no progression for a raid the character never set foot in', () => {
    const raid = raidPartOf({ ...PAYLOAD, raid_progression: {} }, 'tier-mn-1', NOW);

    expect(raid).toMatchObject({ raidProgression: {}, raidAchievementCurve: [] });
  });
});

describe('the Rankwarden sync payload', () => {
  it('sends the season’s runs with what Rankwarden stores, and only the season’s dungeons', () => {
    const payload = syncPayloadOf('us', 'demon-soul', PAYLOAD, [9527, 14938]);

    expect(mplusCharacterSyncSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      season: 'season-mn-2',
      region: 'us',
      realmSlug: 'demon-soul',
      characterName: 'Manongauz',
      realmName: 'Demon Soul',
      faction: 'alliance',
      dungeonRuns: [
        {
          dungeon: {
            id: 9527,
            name: 'Temple of Sethraliss',
            slug: 'temple-of-sethraliss',
            shortName: 'TOS',
          },
          keystoneRunId: 14738020,
          mythicLevel: 14,
          score: 398.6,
          clearTimeMs: 1736151,
          timeRemainingMs: 1920999 - 1736151,
          numChests: 1,
          completedAt: new Date('2026-09-21T00:42:59.000Z'),
          specId: 65,
          role: 'healer',
        },
      ],
      profile: { className: 'Paladin', specName: 'Holy', raceName: 'Human', role: 'healer' },
    });
  });

  it('sends nothing without a run in the season', () => {
    expect(syncPayloadOf('us', 'demon-soul', PAYLOAD, [1234])).toBeNull();
    expect(
      syncPayloadOf('us', 'demon-soul', { ...PAYLOAD, mythic_plus_scores_by_season: [] }, [9527]),
    ).toBeNull();
  });

  it('spells roles as runs do', () => {
    expect([
      roleOf('HEALING'),
      roleOf('TANK'),
      roleOf('DPS'),
      roleOf('healer'),
      roleOf(null),
    ]).toEqual(['healer', 'tank', 'dps', 'healer', null]);
  });

  it('reads the dungeon slug from a run url', () => {
    expect(dungeonSlugOf(RUN.url)).toBe('temple-of-sethraliss');
    expect(
      dungeonSlugOf('https://raider.io/mythic-plus-runs/season-mn-2/1-10-kings-rest?x=1'),
    ).toBe('kings-rest');
    expect(dungeonSlugOf('https://raider.io/characters/us/demon-soul/Manongauz')).toBeNull();
    expect(dungeonSlugOf(undefined)).toBeNull();
  });
});
