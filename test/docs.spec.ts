import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootTestApp, resetRedis, tokenRequest, type Json, type TestApp } from './support/app.js';

let app: TestApp;

beforeAll(async () => {
  app = await bootTestApp();
  await resetRedis(app);
});

afterAll(async () => {
  await resetRedis(app);
  await app?.close();
});

describe('API docs (outside production)', () => {
  it('serves Swagger UI and every asset it loads', async () => {
    const page = await fetch(`${app.url}/docs`);
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');

    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    expect(assets.length).toBeGreaterThan(3);
    for (const asset of assets) {
      const response = await fetch(new URL(asset, `${app.url}/docs`));
      expect(response.status, asset).toBe(200);
    }
  });

  it('does not send the browser to https for the UI, as it still does for the API', async () => {
    const docs = (await fetch(`${app.url}/docs`)).headers.get('content-security-policy') ?? '';
    const api = (await fetch(`${app.url}/health`)).headers.get('content-security-policy') ?? '';

    expect(docs).not.toContain('upgrade-insecure-requests');
    expect(docs).toContain("script-src 'self'");
    expect(api).toContain('upgrade-insecure-requests');
  });

  it('documents every route, its query parameters from the zod schemas, and its security', async () => {
    const spec = (await (await fetch(`${app.url}/docs/openapi.json`)).json()) as Json;

    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/pvp/leaderboard',
        '/search/suggestions',
        '/session',
        '/health',
        '/health/ready',
        '/oidc/token',
      ]),
    );

    const leaderboard = spec.paths['/pvp/leaderboard'].get;
    const params = Object.fromEntries(leaderboard.parameters.map((p: Json) => [p.name, p]));
    expect(params.region).toMatchObject({
      required: true,
      schema: { enum: ['us', 'eu', 'kr', 'tw'] },
    });
    expect(params.pageSize).toMatchObject({
      required: false,
      schema: { default: 50, maximum: 100 },
    });
    expect(params.class.schema.enum).toHaveLength(13);
    expect(leaderboard.security).toEqual([{ 'access-token': [] }]);

    expect(spec.paths['/health'].get.security ?? []).toEqual([]);
  });

  it('lets the docs page itself obtain a token, for "Try it out"', async () => {
    const response = await tokenRequest(
      app,
      { grant_type: 'urn:soulseeker:grant-type:anonymous' },
      { origin: 'http://localhost:3001' },
    );

    expect(response.status).toBe(200);
  });
});
