/** Regions served by the global Blizzard Game Data API (CN uses a separate host). */
export const REGIONS = ['us', 'eu', 'kr', 'tw'] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Regions Blizzard issues OAuth tokens in: the Game Data regions and China,
 * which has a token host of its own though this service reads no data from it.
 */
export const OAUTH_REGIONS = [...REGIONS, 'cn'] as const;

/** The region a token is asked for in. */
export const DEFAULT_OAUTH_REGION: Region = 'us';

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

/**
 * The languages the Profile API answers in. Any of them works on any region's
 * host; the front end picks the visitor's.
 */
export const LOCALES = [
  'en_US',
  'es_MX',
  'pt_BR',
  'en_GB',
  'es_ES',
  'fr_FR',
  'ru_RU',
  'de_DE',
  'pt_PT',
  'it_IT',
  'ko_KR',
  'zh_TW',
] as const;
export type Locale = (typeof LOCALES)[number];

/** The locale names are parsed in and Rankwarden stores them in. */
export const DEFAULT_LOCALE: Locale = 'en_US';

/** Host for a region's API, from `BLIZZARD_API_HOST_TEMPLATE`, e.g. https://us.api.blizzard.com */
export function apiHost(region: Region, template: string): string {
  return template.replaceAll('{region}', region);
}

/**
 * Game Data namespaces. `dynamic` covers seasons and leaderboards, `profile`
 * covers per-character data, `static` covers races, classes and talent trees.
 */
export type NamespaceKind = 'dynamic' | 'profile' | 'static';

/** Namespace for a region, e.g. dynamic-us or profile-eu */
export function namespaceFor(kind: NamespaceKind, region: Region): string {
  return `${kind}-${region}`;
}
