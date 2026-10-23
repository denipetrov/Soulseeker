import { describe, expect, it } from 'vitest';

import { raiderIoCharacterSchema } from '../../raiderio/schemas/character-profile.schema.js';
import { mplusCharacterSyncSchema } from '../../rankwarden/dto/mplus-character-sync.dto.js';
import type { CatalogueMplusSeason, CatalogueRaid } from '../../seasons/pve-catalogue.service.js';
import {
  bossesPartOf,
  dungeonSlugOf,
  fullFields,
  fullPartOf,
  raidPartOf,
  responseOf,
  roleOf,
  seasonPartOf,
  syncPayloadOf,
  topPercentOf,
  type AnswerExtras,
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
  last_crawled_at: '2026-10-22T00:28:40.000Z',
  profile_url: 'https://raider.io/characters/us/demon-soul/Manongauz',
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
        tier: '36',
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
  raid_achievement_curve: [{ raid: 'tier-mn-1', aotc: '2026-05-11T18:25:00.000Z' }],
  // `:current:previous`: the current season first.
  mythic_plus_scores_by_season: [
    {
      season: 'season-mn-2',
      scores: { all: 1760.9, healer: 1760.9 },
      segments: {
        all: { score: 1760.9, color: '#72ff56' },
        healer: { score: 1760.9, color: '#72ff56' },
      },
    },
    {
      season: 'season-mn-1',
      scores: { all: 3004.5, healer: 3004.5 },
      segments: { all: { score: 3004.5, color: '#3b6bdf' } },
    },
  ],
  mythic_plus_ranks: { overall: { world: 1964157, region: 422278, realm: 928 } },
  mythic_plus_best_runs: [
    RUN,
    // A dungeon the season does not list.
    { ...RUN, zone_id: 1, keystone_run_id: 2, url: 'https://raider.io/x/season-mn-2/2-10-old' },
  ],
  mythic_plus_recent_runs: [{ ...RUN, mythic_level: 9 }],
  mythic_plus_highest_level_runs: [RUN],
  mythic_plus_weekly_highest_level_runs: [{ ...RUN, mythic_level: 12 }],
  mythic_plus_previous_weekly_highest_level_runs: [],
});

const NOW = new Date('2026-10-22T09:00:00Z');

const SEASONS: CatalogueMplusSeason[] = [
  {
    slug: 'season-mn-2',
    name: 'MN Season 2',
    dungeonIds: [9527],
    expansionId: 11,
    cutoffs: { us: { p999: 3900, p990: 1700 }, eu: { p999: 4000, p990: 3500 } },
  },
  { slug: 'season-mn-1', name: 'MN Season 1', dungeonIds: [], expansionId: 11, cutoffs: {} },
];

const RAIDS: CatalogueRaid[] = [
  {
    slug: 'tier-mn-1',
    name: 'Tier MN 1',
    expansionId: 11,
    encounters: [
      { id: 3176, slug: 'imperator-averzian', name: 'Imperator Averzian' },
      { id: 3177, slug: 'vorasius', name: 'Vorasius' },
    ],
  },
];

const extras = (overrides: Partial<AnswerExtras> = {}): AnswerExtras => ({
  mplusSeasons: SEASONS,
  bossRaids: [],
  bosses: null,
  ...overrides,
});

describe('the Raider.io fields', () => {
  it('asks for both seasons, every run list, and the current raids’ AOTC / Cutting Edge', () => {
    const fields = fullFields(['tier-mn-1', 'sporefall']);

    expect(fields).toContain('mythic_plus_scores_by_season:current:previous');
    expect(fields).toContain('raid_achievement_curve:tier-mn-1:sporefall');
    expect(fields).toEqual(
      expect.arrayContaining([
        'mythic_plus_recent_runs',
        'mythic_plus_highest_level_runs',
        'mythic_plus_weekly_highest_level_runs',
        'mythic_plus_previous_weekly_highest_level_runs',
      ]),
    );
    expect(fullFields([]).some((field) => field.startsWith('raid_achievement_curve'))).toBe(false);
  });
});

describe('the whole page', () => {
  const response = responseOf(
    'us',
    'demon-soul',
    { full: fullPartOf(PAYLOAD, NOW) },
    extras(),
    false,
  );

  it('carries the base profile and every asked-for field', () => {
    expect(response).toMatchObject({
      region: 'us',
      realmSlug: 'demon-soul',
      character: {
        name: 'Manongauz',
        activeSpecName: 'Holy',
        activeSpecRole: 'HEALING',
        gender: 'female',
        realm: 'Demon Soul',
        thumbnailUrl: 'https://render/avatar.jpg',
        achievementPoints: 39050,
        profileBanner: 'alliancebanner1',
        profileUrl: 'https://raider.io/characters/us/demon-soul/Manongauz',
        lastCrawledAt: '2026-10-22T00:28:40.000Z',
      },
      guild: { name: 'veow', realm: 'Demon Soul' },
      talentLoadout: { loadout_spec_id: 65, loadout_text: 'CODE', class_talents: [] },
      raidProgression: { 'tier-mn-1': { total_bosses: 9 } },
      raidAchievementCurve: [{ raid: 'tier-mn-1', aotc: '2026-05-11T18:25:00.000Z' }],
      mythicPlusRanks: { overall: { world: 1964157 } },
      fetchedAt: '2026-10-22T09:00:00.000Z',
      stale: false,
    });
    // No raid asked for bosses: the field is absent, not null.
    expect(response).not.toHaveProperty('raidBosses');
  });

  it('keeps only the gear fields the page renders, quality and tier included', () => {
    expect(response.gear).toEqual({
      itemLevelEquipped: 291,
      items: {
        head: {
          item_id: 271465,
          item_level: 308,
          name: 'Warhelm',
          icon: 'inv_helm',
          item_quality: 4,
          tier: '36',
          bonuses: [13452],
          enchants_detail: [{ id: 243981, name: 'Enchant Helm', icon: 'vellum' }],
          gems_detail: [{ id: 240902, name: '16 Mast & 7 Vers', icon: 'gem' }],
        },
      },
    });
  });

  it('gives both seasons’ scores with their colours and standing', () => {
    expect(response.mythicPlusScores).toEqual([
      {
        season: 'season-mn-2',
        scores: { all: 1760.9, healer: 1760.9 },
        colors: { all: '#72ff56', healer: '#72ff56' },
        // Under US 0.1% (3900), over US 1% (1700).
        topPercent: { percent: 1, minScore: 1700 },
      },
      {
        season: 'season-mn-1',
        scores: { all: 3004.5, healer: 3004.5 },
        colors: { all: '#3b6bdf' },
        // The catalogue holds no cutoffs for it.
        topPercent: null,
      },
    ]);
  });

  it('trims runs in every list: no ids, affixes reduced to icon and link, spec to its id', () => {
    expect(response.mythicPlusBestRuns?.[0]).toEqual({
      dungeon: 'Temple of Sethraliss',
      mythic_level: 14,
      completed_at: '2026-09-21T00:42:59.000Z',
      clear_time_ms: 1736151,
      par_time_ms: 1920999,
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
    expect(response.mythicPlusRecentRuns?.map((run) => run.mythic_level)).toEqual([9]);
    expect(response.mythicPlusHighestLevelRuns).toHaveLength(1);
    expect(response.mythicPlusWeeklyHighestLevelRuns?.map((run) => run.mythic_level)).toEqual([12]);
    expect(response.mythicPlusPreviousWeeklyHighestLevelRuns).toEqual([]);
  });

  it('shows the current raids’ bosses, or null when Blizzard could not be asked', () => {
    const bosses = bossesPartOf({ expansions: [] }, RAIDS, NOW);

    const withBosses = responseOf(
      'us',
      'demon-soul',
      { full: fullPartOf(PAYLOAD, NOW) },
      extras({ bossRaids: ['tier-mn-1'], bosses }),
      false,
    );
    const without = responseOf(
      'us',
      'demon-soul',
      { full: fullPartOf(PAYLOAD, NOW) },
      extras({ bossRaids: ['tier-mn-1'], bosses: null }),
      false,
    );

    expect(withBosses.raidBosses).toEqual({ 'tier-mn-1': bosses.raids['tier-mn-1'] });
    expect(without.raidBosses).toBeNull();
  });
});

describe('a raid and a season', () => {
  it('answers with only those parts, dated by the older one', () => {
    const raid = raidPartOf(PAYLOAD, 'tier-mn-1', new Date('2026-10-22T08:00:00Z'));
    const season = seasonPartOf(PAYLOAD, NOW);

    const response = responseOf('us', 'demon-soul', { raid, season }, extras(), false);

    expect(Object.keys(response).sort()).toEqual([
      'character',
      'fetchedAt',
      'mythicPlusScores',
      'raidAchievementCurve',
      'raidProgression',
      'realmSlug',
      'region',
      'stale',
    ]);
    expect(response).toMatchObject({
      raidProgression: { 'tier-mn-1': { summary: '', total_bosses: 9, mythic_bosses_killed: 0 } },
      raidAchievementCurve: [{ raid: 'tier-mn-1', aotc: '2026-05-11T18:25:00.000Z' }],
      fetchedAt: '2026-10-22T08:00:00.000Z',
    });
  });

  it('answers an empty curve and no progression for a raid the character never set foot in', () => {
    const raid = raidPartOf(
      { ...PAYLOAD, raid_progression: {}, raid_achievement_curve: undefined },
      'tier-mn-1',
      NOW,
    );

    expect(raid).toMatchObject({ raidProgression: {}, raidAchievementCurve: [] });
  });
});

describe('top 0.1% / 1%', () => {
  it('compares the score with the region’s cutoffs of that season', () => {
    expect(topPercentOf(3950, SEASONS[0], 'us')).toEqual({ percent: 0.1, minScore: 3900 });
    expect(topPercentOf(3900, SEASONS[0], 'us')).toEqual({ percent: 0.1, minScore: 3900 });
    expect(topPercentOf(3600, SEASONS[0], 'eu')).toEqual({ percent: 1, minScore: 3500 });
    expect(topPercentOf(1000, SEASONS[0], 'us')).toBeNull();
    expect(topPercentOf(9999, SEASONS[0], 'kr')).toBeNull();
    expect(topPercentOf(0, SEASONS[0], 'us')).toBeNull();
    expect(topPercentOf(4000, undefined, 'us')).toBeNull();
  });
});

describe('raid bosses', () => {
  const kill = (name: string, count: number, at: number) => ({
    encounter: { id: 1, name },
    completed_count: count,
    last_kill_timestamp: at,
  });

  it('matches Blizzard’s bosses to the catalogue by name, across instances, per difficulty', () => {
    const part = bossesPartOf(
      {
        expansions: [
          {
            expansion: { id: 516, name: 'Midnight' },
            instances: [
              {
                // One Raider.io tier spans several Blizzard instances.
                instance: { id: 1, name: 'The Voidspire' },
                modes: [
                  {
                    difficulty: { type: 'HEROIC' },
                    progress: { encounters: [kill('Imperator Averzian', 3, Date.UTC(2026, 3, 2))] },
                  },
                  {
                    difficulty: { type: 'MYTHIC' },
                    progress: {
                      encounters: [kill('Imperator Averzian', 6, Date.UTC(2026, 4, 11))],
                    },
                  },
                  // Legacy sizes are not one of the four difficulties.
                  {
                    difficulty: { type: 'LEGACY_25_MAN' },
                    progress: { encounters: [kill('Imperator Averzian', 1, 0)] },
                  },
                ],
              },
            ],
          },
        ],
      },
      RAIDS,
      NOW,
    );

    expect(part).toEqual({
      fetchedAt: '2026-10-22T09:00:00.000Z',
      raids: {
        'tier-mn-1': [
          {
            slug: 'imperator-averzian',
            name: 'Imperator Averzian',
            kills: {
              heroic: { count: 3, lastKillAt: '2026-04-02T00:00:00.000Z' },
              mythic: { count: 6, lastKillAt: '2026-05-11T00:00:00.000Z' },
            },
          },
          // Never killed.
          { slug: 'vorasius', name: 'Vorasius', kills: {} },
        ],
      },
    });
  });

  it('matches the names the two sites spell differently, by their short form', () => {
    const raids: CatalogueRaid[] = [
      {
        slug: 'nerubar-palace',
        name: 'Nerub-ar Palace',
        expansionId: 10,
        encounters: [
          { id: 1, slug: 'sikran', name: 'Sikran' },
          { id: 2, slug: 'one-armed-bandit', name: 'One-Armed Bandit' },
          { id: 3, slug: 'dimensius', name: 'Dimensius' },
        ],
      },
    ];
    // As Blizzard names them.
    const part = bossesPartOf(
      {
        expansions: [
          {
            expansion: { id: 514, name: 'The War Within' },
            instances: [
              {
                instance: { id: 1, name: 'Nerub-ar Palace' },
                modes: [
                  {
                    difficulty: { type: 'MYTHIC' },
                    progress: {
                      encounters: [
                        kill('Sikran, Captain of the Sureki', 4, 0),
                        kill('The One-Armed Bandit', 2, 0),
                        kill('Dimensius, the All-Devouring', 1, 0),
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      raids,
      NOW,
    );

    expect(part.raids['nerubar-palace']?.map((boss) => boss.kills.mythic?.count)).toEqual([
      4, 2, 1,
    ]);
  });

  it('ignores case, accents and punctuation when matching names', () => {
    const part = bossesPartOf(
      {
        expansions: [
          {
            expansion: { id: 516, name: 'Midnight' },
            instances: [
              {
                instance: { id: 1, name: 'March on Quel’Danas' },
                modes: [
                  {
                    difficulty: { type: 'NORMAL' },
                    progress: { encounters: [kill('IMPERATOR AVERZIÁN', 1, Date.UTC(2026, 2, 1))] },
                  },
                ],
              },
            ],
          },
        ],
      },
      RAIDS,
      NOW,
    );

    expect(part.raids['tier-mn-1']?.[0]?.kills).toEqual({
      normal: { count: 1, lastKillAt: '2026-03-01T00:00:00.000Z' },
    });
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
