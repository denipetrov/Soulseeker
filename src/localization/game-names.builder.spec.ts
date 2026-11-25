import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../blizzard/game-data.api.js';
import type { NamedEntry } from '../blizzard/schemas/game-data-index.schema.js';
import { buildGameNames, namesIn } from './game-names.builder.js';

const entry = (id: number, en: string, de?: string, extra: Record<string, string> = {}) => ({
  id,
  name: { en_US: en, ...(de ? { de_DE: de } : {}), ...extra },
});

const indexes = (over: Partial<Record<GameDataIndex, NamedEntry[]>> = {}) =>
  ({
    classes: [entry(3, 'Hunter', 'Jäger', { it_IT: 'Cacciatore', xx_XX: 'nope' })],
    specializations: [entry(262, 'Elemental', 'Elementar')],
    races: [entry(26, 'Pandaren')],
    heroTalentTrees: [entry(56, 'Farseer', 'Scharfseher')],
    keystoneAffixes: [entry(9, 'Tyrannical', 'Tyrannisch')],
    keystoneDungeons: [entry(588, 'Altar of Fangs', 'Altar der Fänge')],
    journalInstances: [
      entry(1305, 'Sporefall', 'Sporenfall'),
      entry(1207, "Amirdrassil, the Dream's Hope", 'Amirdrassil, Hoffnung des Traums'),
    ],
    journalEncounters: [
      entry(2871, 'Rotmire', 'Moderschlamm'),
      entry(2564, 'Gnarlroot', 'Knorrenwurzel'),
      entry(2601, 'Sikran, Captain of the Sureki', 'Sikran, Hauptmann der Sureki'),
    ],
    ...over,
  }) as Record<GameDataIndex, NamedEntry[]>;

const catalogue = {
  raids: [
    {
      slug: 'sporefall',
      name: 'Sporefall',
      encounters: [
        { slug: 'rotmire', name: 'Rotmire' },
        { slug: 'sikran', name: 'Sikran' },
        { slug: 'nobody', name: 'Nobody Knows' },
      ],
    },
    {
      slug: 'awakened-amirdrassil-the-dreams-hope',
      name: "Awakened Amirdrassil, the Dream's Hope",
      encounters: [{ slug: 'awakened-gnarlroot', name: 'Awakened Gnarlroot' }],
    },
    { slug: 'tier-mn-1', name: 'MN Tier 1 (VS / DR / MQD)', encounters: [] },
  ],
  dungeons: [
    { slug: 'altar-of-fangs', name: 'Altar of Fangs', challengeModeId: 588 },
    // No challenge mode id stored: matched by its English name.
    { slug: 'sporefall-dungeon', name: 'Sporefall', challengeModeId: null },
    { slug: 'gone', name: 'Gone Dungeon', challengeModeId: 1 },
  ],
};

const built = buildGameNames(indexes(), catalogue, new Date('2026-11-25T10:00:00Z'));

describe('buildGameNames', () => {
  it('keys classes, specs, races, hero trees and affixes by Blizzard id, in our languages only', () => {
    expect(built.classes['3']).toEqual({ en_US: 'Hunter', de_DE: 'Jäger', it_IT: 'Cacciatore' });
    expect(built.specs['262']).toEqual({ en_US: 'Elemental', de_DE: 'Elementar' });
    expect(built.heroTalents['56']?.de_DE).toBe('Scharfseher');
    expect(built.affixes['9']?.de_DE).toBe('Tyrannisch');
    expect(built.races['26']).toEqual({ en_US: 'Pandaren' });
  });

  it('matches dungeons on the challenge mode id, else the English name', () => {
    expect(built.dungeons['altar-of-fangs']?.de_DE).toBe('Altar der Fänge');
    expect(built.dungeons['sporefall-dungeon']?.de_DE).toBe('Sporenfall');
    expect(built.dungeons).not.toHaveProperty('gone');
    expect(built.unmatched.dungeons).toEqual(['gone']);
  });

  it('matches raids and bosses on the English name, the short form, and a re-release base', () => {
    expect(built.raids['sporefall']).toEqual({
      name: { en_US: 'Sporefall', de_DE: 'Sporenfall' },
      bosses: {
        rotmire: { en_US: 'Rotmire', de_DE: 'Moderschlamm' },
        // Raider.io's "Sikran" is Blizzard's "Sikran, Captain of the Sureki".
        sikran: { en_US: 'Sikran, Captain of the Sureki', de_DE: 'Sikran, Hauptmann der Sureki' },
      },
    });
    expect(built.raids['awakened-amirdrassil-the-dreams-hope']).toEqual({
      name: { en_US: "Amirdrassil, the Dream's Hope", de_DE: 'Amirdrassil, Hoffnung des Traums' },
      bosses: { 'awakened-gnarlroot': { en_US: 'Gnarlroot', de_DE: 'Knorrenwurzel' } },
    });
    expect(built.raids['tier-mn-1']).toEqual({ name: null, bosses: {} });
    expect(built.unmatched.raids).toEqual(['tier-mn-1']);
    expect(built.unmatched.bosses).toEqual(['sporefall/nobody']);
  });
});

describe('namesIn', () => {
  it('picks one language, English where Blizzard has no translation', () => {
    const de = namesIn(built, 'de_DE');

    expect(de).toMatchObject({
      locale: 'de_DE',
      builtAt: '2026-11-25T10:00:00.000Z',
      classes: { '3': 'Jäger' },
      races: { '26': 'Pandaren' },
      dungeons: { 'altar-of-fangs': 'Altar der Fänge' },
    });
    expect(de.raids['sporefall']).toEqual({
      name: 'Sporenfall',
      bosses: { rotmire: 'Moderschlamm', sikran: 'Sikran, Hauptmann der Sureki' },
    });
    expect(de.raids['tier-mn-1']).toEqual({ name: null, bosses: {} });
    expect(namesIn(built, 'ko_KR').classes['3']).toBe('Hunter');
  });
});
