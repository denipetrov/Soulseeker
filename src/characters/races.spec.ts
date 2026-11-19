import { describe, expect, it } from 'vitest';

import { raceIdOf } from './races.js';

describe('raceIdOf', () => {
  it('maps a race name to its one id, whatever the faction', () => {
    expect(raceIdOf('Dwarf', 'alliance')).toBe(3);
    expect(raceIdOf("Mag'har Orc", 'horde')).toBe(36);
    expect(raceIdOf('Human', null)).toBe(1);
  });

  it("picks a faction-split race's id by faction, in any case", () => {
    expect(raceIdOf('Pandaren', 'alliance')).toBe(25);
    expect(raceIdOf('Pandaren', 'HORDE')).toBe(26);
    expect(raceIdOf('Dracthyr', 'horde')).toBe(70);
    expect(raceIdOf('Earthen', 'alliance')).toBe(85);
    expect(raceIdOf('Haranir', 'horde')).toBe(91);
  });

  it('is null for an unknown race, or a split race without a faction', () => {
    expect(raceIdOf('Murloc', 'horde')).toBeNull();
    expect(raceIdOf('Pandaren', null)).toBeNull();
    expect(raceIdOf(null, 'horde')).toBeNull();
  });
});
