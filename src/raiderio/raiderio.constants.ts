/**
 * Regions Raider.io serves characters for.
 *
 * Its own list rather than Blizzard's `REGIONS`: Raider.io serves China, which
 * the global Blizzard Game Data API does not.
 */
export const RAIDERIO_REGIONS = ['us', 'eu', 'kr', 'tw', 'cn'] as const;
export type RaiderIoRegion = (typeof RAIDERIO_REGIONS)[number];

export function isRaiderIoRegion(value: string): value is RaiderIoRegion {
  return (RAIDERIO_REGIONS as readonly string[]).includes(value);
}
