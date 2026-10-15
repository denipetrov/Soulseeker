import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.schema.js';

/** The smallest environment that validates. */
const REQUIRED = {
  MONGODB_URI: 'mongodb://localhost:27017',
  BLIZZARD_CLIENT_ID: 'id',
  BLIZZARD_CLIENT_SECRET: 'secret',
  RAIDER_IO_API_KEY: 'key',
};

const PRODUCTION_KEYS = JSON.stringify({ keys: [{ kty: 'EC', kid: 'k1', d: 'private' }] });

describe('validateEnv', () => {
  it('fills every default from the four required variables', () => {
    const env = validateEnv(REQUIRED);

    expect(env.PORT).toBe(3001);
    expect(env.MONGODB_DB).toBe('rankwarden');
    expect(env.BLIZZARD_REGIONS).toEqual(['us', 'eu', 'kr', 'tw']);
    expect(env.OIDC_JWKS).toBeNull();
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('names every missing required variable at once', () => {
    expect(() => validateEnv({})).toThrow(
      /MONGODB_URI[\s\S]*BLIZZARD_CLIENT_ID[\s\S]*BLIZZARD_CLIENT_SECRET[\s\S]*RAIDER_IO_API_KEY/,
    );
  });

  it('refuses production without signing keys, cookie keys or https', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'production' })).toThrow(
      /OIDC_JWKS[\s\S]*OIDC_COOKIE_KEYS[\s\S]*OIDC_ISSUER: must be https/,
    );
  });

  it('accepts a complete production configuration', () => {
    const env = validateEnv({
      ...REQUIRED,
      NODE_ENV: 'production',
      OIDC_JWKS: PRODUCTION_KEYS,
      OIDC_COOKIE_KEYS: 'a,b',
      OIDC_ISSUER: 'https://api.example.com/oidc',
    });

    expect(env.OIDC_JWKS?.keys).toHaveLength(1);
    expect(env.OIDC_COOKIE_KEYS).toEqual(['a', 'b']);
  });

  it('refuses a key set without private keys', () => {
    expect(() =>
      validateEnv({ ...REQUIRED, OIDC_JWKS: JSON.stringify({ keys: [{ kty: 'EC', kid: 'k' }] }) }),
    ).toThrow(/OIDC_JWKS: must hold at least one private key/);
  });

  it('refuses an origin with a path or trailing slash', () => {
    expect(() => validateEnv({ ...REQUIRED, CORS_ORIGINS: 'https://example.com/' })).toThrow(
      /not a bare origin/,
    );
  });

  it('refuses an issuer that is not the /oidc mount', () => {
    expect(() => validateEnv({ ...REQUIRED, OIDC_ISSUER: 'http://localhost:3001' })).toThrow(
      /OIDC_ISSUER: must end in \/oidc/,
    );
  });

  it('refuses an unknown region', () => {
    expect(() => validateEnv({ ...REQUIRED, BLIZZARD_REGIONS: 'us,eur' })).toThrow(
      /unknown region/,
    );
  });

  it('refuses Turnstile without its secret', () => {
    expect(() => validateEnv({ ...REQUIRED, TURNSTILE_ENABLED: 'true' })).toThrow(
      /TURNSTILE_SECRET/,
    );
  });

  it('refuses a path template with a misspelt placeholder', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED,
        BLIZZARD_PATH_CHARACTER_PROFILE: 'profile/wow/character/{realm}/{characterName}',
      }),
    ).toThrow(/missing \{realmSlug\}; unknown \{realm\}/);
  });

  it('refuses an access token that outlives its refresh token', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED,
        OIDC_ACCESS_TOKEN_TTL_SECONDS: '3600',
        OIDC_REFRESH_TOKEN_TTL_SECONDS: '600',
      }),
    ).toThrow(/OIDC_ACCESS_TOKEN_TTL_SECONDS/);
  });
});
