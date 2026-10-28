import { z } from 'zod';

import {
  DEFAULT_OAUTH_REGION,
  OAUTH_REGIONS,
  REGIONS,
  type Region,
} from '../blizzard/blizzard.constants.js';
import { placeholdersIn } from '../common/utils/path-template.js';
import { RAIDERIO_REGIONS, type RaiderIoRegion } from '../raiderio/raiderio.constants.js';

const split = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const trimTrailingSlashes = (value: string) => {
  let trimmed = value;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);

  return trimmed;
};

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

/** A positive integer with a default; every count, size and duration here. */
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegativeInt = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

/**
 * The path of one upstream endpoint, relative to that upstream's host.
 *
 * Configuration rather than code, so a path the upstream renames can be
 * corrected in the deployment without a new build. A template must use each
 * placeholder the service fills in and no other, so a typo fails at boot
 * instead of on the first request. Same rules as Rankwarden's.
 */
const pathTemplate = (fallback: string, placeholders: readonly string[] = []) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      let path = trimTrailingSlashes(value.trim());
      while (path.startsWith('/')) path = path.slice(1);

      if (path.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'must not be empty' });
        return z.NEVER;
      }

      if (/[\s?#]/.test(path) || path.includes('://')) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a path only: no host, query string, fragment or whitespace',
        });
        return z.NEVER;
      }

      const used = placeholdersIn(path);
      const braces = (names: readonly string[]) => names.map((name) => `{${name}}`).join(', ');
      const missing = placeholders.filter((name) => !used.includes(name));
      const unknown = used.filter((name) => !placeholders.includes(name));

      if (missing.length > 0 || unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            `expects ${placeholders.length > 0 ? braces(placeholders) : 'no placeholders'}` +
            (missing.length > 0 ? `; missing ${braces(missing)}` : '') +
            (unknown.length > 0 ? `; unknown ${braces(unknown)}` : ''),
        });
        return z.NEVER;
      }

      return path;
    });

/** Comma-separated values that must each be one of `allowed`, deduplicated. */
const csvOf = <T extends string>(fallback: string, allowed: readonly T[], what: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      const parts = split(value).map((part) => part.toLowerCase());

      if (parts.length === 0) {
        ctx.addIssue({ code: 'custom', message: `must name at least one ${what}` });
        return z.NEVER;
      }

      const unknown = parts.filter((part) => !(allowed as readonly string[]).includes(part));

      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown ${what}(s) ${unknown.join(', ')}; expected any of ${allowed.join(', ')}`,
        });
        return z.NEVER;
      }

      return [...new Set(parts)] as T[];
    });

/** An absolute http(s) URL, without a trailing slash. */
const baseUrl = (fallback?: string) => {
  const base = fallback === undefined ? z.string() : z.string().default(fallback);

  return base.pipe(z.url({ protocol: /^https?$/ })).transform(trimTrailingSlashes);
};

/**
 * Exact browser origins, e.g. `https://rankwarden.gg`. Compared verbatim
 * against the `Origin` header, so a trailing slash or a path is a mistake that
 * would silently refuse every request: both are rejected here.
 */
const originCsv = z
  .string()
  .default('http://localhost:5173')
  .transform((value, ctx) => {
    const origins = split(value);

    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        ctx.addIssue({ code: 'custom', message: `"${origin}" is not a URL` });
        return z.NEVER;
      }

      if (parsed.origin !== origin) {
        ctx.addIssue({
          code: 'custom',
          message: `"${origin}" is not a bare origin; expected "${parsed.origin}"`,
        });
        return z.NEVER;
      }
    }

    return origins;
  });

/**
 * The private signing keys of the authorization server, as a JWKS document
 * (`{"keys":[…]}`). Generated once by `npm run keys:generate` or
 * `deploy/scripts/create-secrets.sh`, and kept in the Secret.
 *
 * Empty is allowed outside production: the service then generates a key at
 * boot, which is fine for one developer process and wrong for anything else —
 * every restart would invalidate every token, and two replicas would each
 * refuse the other's.
 */
const jwks = z
  .string()
  .default('')
  .transform((value, ctx) => {
    if (value.trim() === '') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON Web Key Set: {"keys":[...]}' });
      return z.NEVER;
    }

    const result = z
      .object({
        keys: z
          .array(
            z
              .object({ kty: z.string(), kid: z.string().min(1), d: z.string().min(1) })
              .passthrough(),
          )
          .min(1),
      })
      .safeParse(parsed);

    if (!result.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'must hold at least one private key, each with a "kid" and its private part "d"',
      });
      return z.NEVER;
    }

    return result.data as { keys: Record<string, unknown>[] };
  });

export const envSchema = z.object({
  // Runtime.
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: positiveInt(3001),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  /**
   * Proxy hops in front of the service whose `X-Forwarded-For` is trusted: 1
   * behind the cluster gateway, 0 when hit directly. Every per-IP limit keys on
   * the address this yields, so too high lets a client pick its own address and
   * too low puts every visitor behind the gateway's one.
   */
  TRUST_PROXY_HOPS: nonNegativeInt(0),

  // MongoDB: read-only, as `rankwarden_backend`. Credentials go in the URI.
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default('rankwarden'),
  MONGODB_SOCKET_TIMEOUT_MS: positiveInt(30_000),

  // Redis: cache, request budgets, rate limits and OAuth state.
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /** Prefixed to every key, so one Redis can be shared without collisions. */
  REDIS_KEY_PREFIX: z
    .string()
    .regex(/^[a-z0-9_-]+:$/i, 'must be letters, digits, _ or -, ending in ":"')
    .default('ss:'),

  // Blizzard. Soulseeker's own API client: its own quota, never Rankwarden's.
  BLIZZARD_CLIENT_ID: z.string().min(1),
  BLIZZARD_CLIENT_SECRET: z.string().min(1),
  BLIZZARD_REGION: z.enum(OAUTH_REGIONS).default(DEFAULT_OAUTH_REGION),
  BLIZZARD_REGIONS: csvOf<Region>('us,eu,kr,tw', REGIONS, 'region'),
  BLIZZARD_LOCALE: z.string().default('en_US'),
  BLIZZARD_API_HOST_TEMPLATE: z
    .string()
    .default('https://{region}.api.blizzard.com')
    .refine((value) => value.includes('{region}'), 'must contain {region}')
    .transform(trimTrailingSlashes),
  BLIZZARD_PATH_CHARACTER_PROFILE: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_SPECIALIZATIONS: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/specializations',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_PVP_BRACKET: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/pvp-bracket/{bracket}',
    ['realmSlug', 'characterName', 'bracket'],
  ),
  BLIZZARD_PATH_CHARACTER_MEDIA: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/character-media',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_PVP_SUMMARY: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/pvp-summary',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_STATISTICS: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/statistics',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_EQUIPMENT: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/equipment',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_ACHIEVEMENTS: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/achievements',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_RAID_ENCOUNTERS: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/encounters/raids',
    ['realmSlug', 'characterName'],
  ),
  BLIZZARD_PATH_CHARACTER_ACHIEVEMENT_STATISTICS: pathTemplate(
    'profile/wow/character/{realmSlug}/{characterName}/achievements/statistics',
    ['realmSlug', 'characterName'],
  ),
  /**
   * Short, because a person is waiting on the answer: a lookup that takes
   * longer than this is better served stale from Mongo than late.
   */
  BLIZZARD_REQUEST_TIMEOUT_MS: positiveInt(10_000),
  BLIZZARD_RETRY_LIMIT: nonNegativeInt(1),
  /** Blizzard's published ceilings for one client: 36,000 an hour, 100 a second. */
  BLIZZARD_HOURLY_LIMIT: positiveInt(36_000),
  BLIZZARD_PER_SECOND_LIMIT: positiveInt(100),
  /** Share of each ceiling actually planned against; the rest is headroom. */
  BLIZZARD_UTILISATION: z.coerce.number().positive().max(1).default(0.9),

  // Raider.io. Soulseeker's own key: its own minute window.
  RAIDER_IO_API_KEY: z.string().min(1),
  RAIDERIO_API_BASE_URL: baseUrl('https://raider.io/api/v1'),
  RAIDERIO_REGIONS: csvOf<RaiderIoRegion>('us,eu,kr,tw,cn', RAIDERIO_REGIONS, 'region'),
  RAIDERIO_PATH_CHARACTER_PROFILE: pathTemplate('characters/profile'),
  RAIDERIO_PATH_GUILD_PROFILE: pathTemplate('guilds/profile'),
  RAIDERIO_PATH_GUILD_BOSS_KILL: pathTemplate('guilds/boss-kill'),
  RAIDERIO_REQUEST_TIMEOUT_MS: positiveInt(10_000),
  RAIDERIO_RETRY_LIMIT: nonNegativeInt(1),
  RAIDERIO_MINUTE_LIMIT: positiveInt(1_000),
  RAIDERIO_UTILISATION: z.coerce.number().positive().max(1).default(0.9),

  /**
   * How long a request may wait for a short budget window (a second) to roll
   * before giving up. Longer windows are never waited on: a person is behind
   * every request, and a minute's wait is worse than a stale answer.
   */
  BUDGET_WAIT_MS: nonNegativeInt(2_000),

  // Rankwarden's sync endpoints, cluster-internal.
  RANKWARDEN_BASE_URL: baseUrl('http://localhost:3000'),
  RANKWARDEN_TIMEOUT_MS: positiveInt(10_000),
  /** Retries of a 409 (the owning job is running), with backoff. */
  RANKWARDEN_SYNC_RETRY_LIMIT: nonNegativeInt(3),
  RANKWARDEN_SYNC_RETRY_BASE_MS: positiveInt(5_000),
  /**
   * How long a character page waits for its own sync before answering. The
   * page reads `previousRating` after the sync, so it waits; but a person is
   * behind it, so not for long, and only for one attempt.
   */
  RANKWARDEN_SYNC_INLINE_TIMEOUT_MS: positiveInt(3_000),

  // OAuth 2.0 authorization server (oidc-provider), mounted at /oidc.
  /** The issuer: the public URL of the /oidc mount, e.g. https://api.rankwarden.gg/oidc */
  OIDC_ISSUER: baseUrl('http://localhost:3001/oidc'),
  OIDC_JWKS: jwks,
  /** Keys that sign the provider's cookies, newest first. Comma-separated. */
  OIDC_COOKIE_KEYS: z
    .string()
    .default('')
    .transform((value) => split(value)),
  OIDC_CLIENT_ID: z.string().min(1).default('soulseeker-web'),
  /** The API's resource indicator: the `aud` of every access token. */
  OIDC_API_RESOURCE: z.url().default('https://api.rankwarden.local'),
  OIDC_ACCESS_TOKEN_TTL_SECONDS: positiveInt(600),
  OIDC_REFRESH_TOKEN_TTL_SECONDS: positiveInt(43_200),
  /**
   * The longest one anonymous session lives however often it is refreshed.
   * A refresh rotates the token but not the grant behind it.
   */
  OIDC_SESSION_MAX_SECONDS: positiveInt(2_592_000),
  /** Browser origins allowed to call the API and to obtain tokens. */
  CORS_ORIGINS: originCsv,

  // Anti-scraping on token issuance.
  TURNSTILE_ENABLED: flag('false'),
  TURNSTILE_SECRET: z.string().default(''),
  TURNSTILE_VERIFY_URL: baseUrl('https://challenges.cloudflare.com/turnstile/v0/siteverify'),

  // Rate limits, per minute.
  /** Anonymous token grants per client IP. */
  RATE_LIMIT_TOKEN_PER_MINUTE: positiveInt(10),
  /** API requests per token subject. */
  RATE_LIMIT_API_PER_MINUTE: positiveInt(120),
  /** API requests per client IP, across every subject behind it. */
  RATE_LIMIT_API_IP_PER_MINUTE: positiveInt(600),

  // Cache.
  CACHE_DEFAULT_TTL_SECONDS: positiveInt(300),
  CACHE_CHARACTER_TTL_SECONDS: positiveInt(900),
  /** How long one search prefix's suggestions are reused. Short: ladders move hourly. */
  SEARCH_CACHE_TTL_SECONDS: positiveInt(60),
  /** PvP seasons and their title cutoffs: they change a few times a day at most. */
  PVP_SEASONS_CACHE_TTL_SECONDS: positiveInt(3_600),
  /** How long one leaderboard page is reused. Rankwarden rewrites the ladders hourly. */
  LEADERBOARD_CACHE_TTL_SECONDS: positiveInt(60),
  /**
   * How long a PvP character page is served without asking Blizzard again. One
   * page costs about 13 Blizzard requests, so this is long on purpose.
   */
  PVP_CHARACTER_CACHE_TTL_SECONDS: positiveInt(21_600),
  /**
   * How long an expired page is kept past its TTL, to be served marked stale
   * when the Blizzard budget is spent.
   */
  PVP_CHARACTER_STALE_SECONDS: positiveInt(86_400),
  /**
   * How long a PvE character page is served without asking Raider.io again. One
   * lookup is one Raider.io request, so this is shorter than the PvP page's.
   */
  PVE_CHARACTER_CACHE_TTL_SECONDS: positiveInt(3_600),
  /** How long an expired PvE page is kept past its TTL, to be served stale. */
  PVE_CHARACTER_STALE_SECONDS: positiveInt(86_400),
  /** The shortest gap between two `forceRefresh` lookups of one PvE character. */
  PVE_CHARACTER_REFRESH_COOLDOWN_SECONDS: positiveInt(300),
  /**
   * How long a guild's summary and raid encounters are served without asking
   * Raider.io again. The full roster is never cached.
   */
  GUILD_CACHE_TTL_SECONDS: positiveInt(3_600),
  /** A boss kill is history: it does not change once it happened. */
  GUILD_BOSS_KILL_CACHE_TTL_SECONDS: positiveInt(86_400),
  /** How long an expired guild part is kept past its TTL, to be served stale. */
  GUILD_STALE_SECONDS: positiveInt(86_400),
  /** The shortest gap between two `forceRefresh` lookups of one guild. */
  GUILD_REFRESH_COOLDOWN_SECONDS: positiveInt(300),
  /**
   * How long the raid and Mythic+ season catalogue is held in memory before it
   * is read again. Rankwarden re-reads both once a day.
   */
  PVE_CATALOGUE_TTL_SECONDS: positiveInt(86_400),
  /** The shortest gap between two `forceRefresh` lookups of one character. */
  PVP_CHARACTER_REFRESH_COOLDOWN_SECONDS: positiveInt(300),
});

const validatedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    if (!env.OIDC_JWKS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_JWKS'],
        message:
          'is required in production: without it every restart invalidates every token, ' +
          "and replicas refuse each other's",
      });
    }

    if (env.OIDC_COOKIE_KEYS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_COOKIE_KEYS'],
        message: 'is required in production',
      });
    }

    if (!env.OIDC_ISSUER.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER'],
        message: 'must be https in production',
      });
    }
  }

  if (env.TURNSTILE_ENABLED && env.TURNSTILE_SECRET.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['TURNSTILE_SECRET'],
      message: 'is required when TURNSTILE_ENABLED is true',
    });
  }

  if (!env.OIDC_ISSUER.endsWith('/oidc')) {
    ctx.addIssue({
      code: 'custom',
      path: ['OIDC_ISSUER'],
      message: 'must end in /oidc, where the authorization server is mounted',
    });
  }

  if (env.OIDC_REFRESH_TOKEN_TTL_SECONDS > env.OIDC_SESSION_MAX_SECONDS) {
    ctx.addIssue({
      code: 'custom',
      path: ['OIDC_REFRESH_TOKEN_TTL_SECONDS'],
      message: 'must not exceed OIDC_SESSION_MAX_SECONDS',
    });
  }

  if (env.OIDC_ACCESS_TOKEN_TTL_SECONDS >= env.OIDC_REFRESH_TOKEN_TTL_SECONDS) {
    ctx.addIssue({
      code: 'custom',
      path: ['OIDC_ACCESS_TOKEN_TTL_SECONDS'],
      message: 'must be shorter than OIDC_REFRESH_TOKEN_TTL_SECONDS',
    });
  }

  // The per-second ceiling cannot be reached inside an hour that is smaller
  // than it: one of the two would be decorative.
  if (env.BLIZZARD_PER_SECOND_LIMIT > env.BLIZZARD_HOURLY_LIMIT) {
    ctx.addIssue({
      code: 'custom',
      path: ['BLIZZARD_PER_SECOND_LIMIT'],
      message: 'must not exceed BLIZZARD_HOURLY_LIMIT',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = validatedEnvSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
