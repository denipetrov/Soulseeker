import { describe, expect, it } from 'vitest';

import {
  raiderIoBossKillSchema,
  raiderIoGuildSchema,
} from '../../raiderio/schemas/guild-profile.schema.js';
import { bossKillPartOf, raidEncountersPartOf, summaryPartOf } from './guild.mapper.js';

const NOW = new Date('2026-10-26T09:00:00Z');

const member = (rank: number, name: string) => ({
  rank,
  character: { name, class: 'Mage', realm: 'Tarren Mill', profile_banner: 'hordebanner1' },
});

/** Parsed as the client parses it. */
const PROFILE = raiderIoGuildSchema.parse({
  name: 'Echo',
  displayName: null,
  faction: 'horde',
  region: 'eu',
  realm: 'Tarren Mill',
  last_crawled_at: '2026-10-26T07:14:48.000Z',
  profile_url: 'https://raider.io/guilds/eu/tarren-mill/Echo',
  raid_progression: { 'tier-mn-1': { summary: '9/9 M', total_bosses: 9 } },
  raid_rankings: { 'tier-mn-1': { mythic: { world: 2, region: 1, realm: 1 } } },
  raid_encounters: [
    { slug: 'midnight-falls', name: 'Midnight Falls', defeatedAt: '2026-04-07T12:23:33.000Z' },
  ],
  members: [member(4, 'Raider'), member(1, 'Officer'), member(0, 'Master'), member(2, 'Alt')],
});

describe('the guild summary', () => {
  it('keeps the guild, its progression and rankings, and only ranks 0 and 1, master first', () => {
    expect(summaryPartOf(PROFILE, NOW)).toEqual({
      fetchedAt: '2026-10-26T09:00:00.000Z',
      guild: {
        name: 'Echo',
        displayName: null,
        faction: 'horde',
        realm: 'Tarren Mill',
        region: 'eu',
        profileUrl: 'https://raider.io/guilds/eu/tarren-mill/Echo',
        lastCrawledAt: '2026-10-26T07:14:48.000Z',
      },
      raidProgression: { 'tier-mn-1': { summary: '9/9 M', total_bosses: 9 } },
      raidRankings: { 'tier-mn-1': { mythic: { world: 2, region: 1, realm: 1 } } },
      members: [member(0, 'Master'), member(1, 'Officer')],
    });
  });
});

describe('a raid’s encounters', () => {
  it('lists the bosses killed, with when, and none for a raid not started', () => {
    expect(raidEncountersPartOf(PROFILE, NOW).encounters).toEqual([
      { slug: 'midnight-falls', name: 'Midnight Falls', defeatedAt: '2026-04-07T12:23:33.000Z' },
    ]);
    expect(
      raidEncountersPartOf({ ...PROFILE, raid_encounters: undefined }, NOW).encounters,
    ).toEqual([]);
  });
});

describe('a boss kill', () => {
  it('keeps Raider.io’s kill and roster as they come', () => {
    const roster = [
      {
        character: { id: 1, name: 'Gingipumper', talentLoadout: { specId: 64 }, items: {} },
        vantus: true,
      },
    ];
    const kill = { pulledAt: '2026-04-07T12:13:37.541Z', durationMs: 596022, isSuccess: true };

    expect(bossKillPartOf(raiderIoBossKillSchema.parse({ kill, roster }), NOW)).toEqual({
      fetchedAt: '2026-10-26T09:00:00.000Z',
      kill,
      roster,
    });
  });

  it('answers no kill and no roster for a boss the guild has not killed', () => {
    expect(bossKillPartOf(raiderIoBossKillSchema.parse({}), NOW)).toEqual({
      fetchedAt: '2026-10-26T09:00:00.000Z',
      kill: null,
      roster: [],
    });
  });
});
