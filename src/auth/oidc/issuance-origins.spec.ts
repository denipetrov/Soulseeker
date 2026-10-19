import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.schema.js';
import { docsEnabled } from '../../docs/swagger.js';
import { issuanceOrigins } from './issuance-origins.js';

const config = (env: Partial<Env>) =>
  ({
    get: (key: keyof Env) =>
      ({
        CORS_ORIGINS: ['https://rankwarden.gg'],
        OIDC_ISSUER: 'https://api.rankwarden.gg/oidc',
        ...env,
      })[key as string],
  }) as unknown as ConfigService<Env, true>;

describe('docs and the origins that may obtain tokens', () => {
  it('serves no docs in production, and admits only the front end', () => {
    const production = config({ NODE_ENV: 'production' });

    expect(docsEnabled(production)).toBe(false);
    expect([...issuanceOrigins(production)]).toEqual(['https://rankwarden.gg']);
  });

  it("serves docs elsewhere, and admits the service's own origin for them", () => {
    const development = config({
      NODE_ENV: 'development',
      OIDC_ISSUER: 'http://localhost:3001/oidc',
    });

    expect(docsEnabled(development)).toBe(true);
    expect([...issuanceOrigins(development)]).toEqual([
      'https://rankwarden.gg',
      'http://localhost:3001',
    ]);
  });
});
