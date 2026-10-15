import type { RaiderIoRegion } from '../../raiderio/raiderio.constants.js';

/**
 * A document in Rankwarden's `mplus_characters`: one Mythic+ character per
 * season, folded from the top runs. Read-only here; the shape is Rankwarden's
 * (`src/mplus/entities/mplus-character.entity.ts`).
 *
 * Reader rules that bite:
 * - a different collection with different ids from PvP `characters`: join the
 *   two on `region` + `realmSlug` + lowercased name, never on an id;
 * - `mythicScore` is summed over the runs Rankwarden ingested, not Raider.io's
 *   score: compare characters only with the same `dungeonsCovered`;
 * - `dungeonRuns[].keystoneRunId` may not resolve in `mplus_runs` any more.
 */
export interface DungeonRef {
  id: number;
  name: string;
  slug: string;
  shortName: string | null;
}

export interface DungeonRun {
  dungeon: DungeonRef;
  keystoneRunId: number;
  mythicLevel: number;
  score: number;
  clearTimeMs: number;
  timeRemainingMs: number | null;
  numChests: number | null;
  completedAt: Date;
  specId: number | null;
  role: string;
}

export interface MplusCharacterDocument {
  /** Raider.io season slug, e.g. `season-mn-2`. */
  season: string;
  seasonId: number | null;
  region: RaiderIoRegion;
  /** `region/realmSlug/lowercased-name`, e.g. `us/area-52/skollcat`. The identity. */
  key: string;
  realmSlug: string;
  /** NFC-normalised, lowercased name. */
  nameKey: string;
  characterName: string;
  characterType: 'M+';
  /** For links to raider.io only; not Blizzard's id. */
  rioCharacterId: number | null;
  realmId: number | null;
  realmName: string | null;
  faction: string | null;
  profile: {
    classId: number;
    className: string;
    specId: number | null;
    specName: string | null;
    raceId: number | null;
    raceName: string | null;
    level: number | null;
    role: string | null;
  };
  mythicScore: number;
  dungeonsCovered: number;
  /** Best run per dungeon, highest score first. */
  dungeonRuns: DungeonRun[];
  updatedAt: Date;
}

/** The identity key Rankwarden builds: `region/realmSlug/lowercased-NFC-name`. */
export function mplusCharacterKey(region: string, realmSlug: string, name: string): string {
  return `${region}/${realmSlug}/${name.normalize('NFC').toLowerCase()}`;
}
