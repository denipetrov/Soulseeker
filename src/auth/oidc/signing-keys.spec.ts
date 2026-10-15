import { describe, expect, it } from 'vitest';

import { generateSigningKey, publicKeyOf, resolveSigningKeys } from './signing-keys.js';

describe('signing keys', () => {
  it('generates an ES256 key with an id', async () => {
    const key = await generateSigningKey();

    expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(key.kid).toBeTruthy();
    expect(key.d).toBeTruthy();
  });

  it('never hands a verifier the private part', async () => {
    const key = await generateSigningKey();
    const pub = publicKeyOf(key);

    expect(pub.d).toBeUndefined();
    expect(pub).toMatchObject({ kid: key.kid, x: key.x, y: key.y });
  });

  it('uses the configured keys when there are any', async () => {
    const key = await generateSigningKey();
    const keys = await resolveSigningKeys({ keys: [key as Record<string, unknown>] });

    expect(keys.privateJwks.keys).toEqual([key]);
    expect(keys.publicJwks.keys[0]?.d).toBeUndefined();
  });

  it('generates one for the process when none is configured', async () => {
    const keys = await resolveSigningKeys(null);

    expect(keys.privateJwks.keys).toHaveLength(1);
  });
});
