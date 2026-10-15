import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { exportJWK, generateKeyPair, type JWK } from 'jose';

import { SIGNING_ALG } from '../auth.constants.js';

export interface SigningKeys {
  /** Private keys, for the authorization server. */
  privateJwks: { keys: JWK[] };
  /** The same keys without their private parts, for verifying in the API. */
  publicJwks: { keys: JWK[] };
}

/** Members of a JWK that are private: everything a verifier must never see. */
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'] as const;

export function publicKeyOf(key: JWK): JWK {
  const copy: Record<string, unknown> = { ...key };
  for (const member of PRIVATE_MEMBERS) delete copy[member];

  return copy as JWK;
}

/** A fresh ES256 signing key, as `npm run keys:generate` and `create-secrets.sh` make. */
export async function generateSigningKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair(SIGNING_ALG, { extractable: true });

  return { ...(await exportJWK(privateKey)), kid: randomUUID(), alg: SIGNING_ALG, use: 'sig' };
}

/**
 * The configured keys, or — outside production, where configuration refuses
 * their absence — one generated for this process.
 */
export async function resolveSigningKeys(
  configured: { keys: Record<string, unknown>[] } | null,
): Promise<SigningKeys> {
  let keys: JWK[];

  if (configured) {
    keys = configured.keys as JWK[];
  } else {
    new Logger('SigningKeys').warn(
      'OIDC_JWKS is not set: signing with a key generated for this process. Tokens will not ' +
        'survive a restart. Run "npm run keys:generate" to make a lasting one.',
    );
    keys = [await generateSigningKey()];
  }

  return { privateJwks: { keys }, publicJwks: { keys: keys.map(publicKeyOf) } };
}
