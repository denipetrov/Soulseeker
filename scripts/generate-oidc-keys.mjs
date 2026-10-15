// Prints the two OAuth secrets Soulseeker needs, ready for a .env file:
//
//   npm run keys:generate >> .env
//
// OIDC_JWKS         one ES256 private signing key, as a JWK Set
// OIDC_COOKIE_KEYS  one random cookie-signing key
//
// Run once per environment. Rotating the signing key logs every visitor out
// once their access token expires; to rotate without that, put the new key
// first in "keys" and keep the old one after it until the longest refresh
// token has expired. deploy/scripts/create-secrets.sh runs this for the
// cluster, which is why it needs nothing but Node itself.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), alg: 'ES256', use: 'sig' };

console.log(`OIDC_JWKS=${JSON.stringify({ keys: [jwk] })}`);
console.log(`OIDC_COOKIE_KEYS=${randomBytes(32).toString('base64url')}`);
