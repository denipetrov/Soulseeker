/** The grant a front-end visitor without an account uses to obtain tokens. */
export const ANONYMOUS_GRANT_TYPE = 'urn:soulseeker:grant-type:anonymous';

/** The one scope the API grants today: read everything public. */
export const API_READ_SCOPE = 'api:read';

/** Signing algorithm of every token the authorization server issues. */
export const SIGNING_ALG = 'ES256';

/** Where the authorization server is mounted. `OIDC_ISSUER` must end in it. */
export const OIDC_MOUNT_PATH = '/oidc';

/** Account ids are `<kind>:<id>`: `anon:<uuid>` today, `bnet:<battletag id>` later. */
export const AccountKind = {
  Anonymous: 'anon',
} as const;

export const OIDC_PROVIDER = Symbol('OIDC_PROVIDER');
export const SIGNING_KEYS = Symbol('SIGNING_KEYS');
