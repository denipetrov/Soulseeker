/**
 * Blizzard's playable race ids by English name, for answers that only have the
 * name (Raider.io's profile). Four races have one id per faction; the rest one.
 *
 * Taken from the ids Rankwarden stores from Blizzard's profiles (2026-11-19).
 * A race Blizzard adds answers a null id until it is listed here.
 */
const RACE_IDS: Readonly<Record<string, number | { alliance: number; horde: number }>> = {
  Human: 1,
  Orc: 2,
  Dwarf: 3,
  'Night Elf': 4,
  Undead: 5,
  Tauren: 6,
  Gnome: 7,
  Troll: 8,
  Goblin: 9,
  'Blood Elf': 10,
  Draenei: 11,
  Worgen: 22,
  // 24 is the neutral Pandaren, before a faction is chosen: no rated character has it.
  Pandaren: { alliance: 25, horde: 26 },
  Nightborne: 27,
  'Highmountain Tauren': 28,
  'Void Elf': 29,
  'Lightforged Draenei': 30,
  'Zandalari Troll': 31,
  'Kul Tiran': 32,
  'Dark Iron Dwarf': 34,
  Vulpera: 35,
  "Mag'har Orc": 36,
  Mechagnome: 37,
  Dracthyr: { alliance: 52, horde: 70 },
  Earthen: { alliance: 85, horde: 84 },
  Haranir: { alliance: 86, horde: 91 },
};

/**
 * Blizzard's race id for an English race name and the character's faction
 * (`alliance` / `horde`, any case). Null for an unknown race, or a
 * faction-split race without a faction.
 */
export function raceIdOf(
  name: string | null | undefined,
  faction: string | null | undefined,
): number | null {
  const entry = name ? RACE_IDS[name] : undefined;
  if (entry === undefined) return null;
  if (typeof entry === 'number') return entry;

  const side = faction?.toLowerCase();
  return side === 'alliance' || side === 'horde' ? entry[side] : null;
}
