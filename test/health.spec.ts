import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootTestApp, type Json, type TestApp } from './support/app.js';

let app: TestApp;

beforeAll(async () => {
  app = await bootTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('health', () => {
  it('answers liveness without a token', async () => {
    const response = await fetch(`${app.url}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('is ready with MongoDB and Redis up, upstreams not yet observed', async () => {
    const response = await fetch(`${app.url}/health/ready`);
    const body = (await response.json()) as Json;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.dependencies.mongo.status).toBe('ok');
    expect(body.dependencies.redis.status).toBe('ok');
    expect(body.dependencies.blizzard.status).toBe('unknown');
    expect(body.budgets).toHaveLength(2);
  });

  it('never reports a connection string', async () => {
    const text = await (await fetch(`${app.url}/health/ready`)).text();

    expect(text).not.toContain('mongodb://');
    expect(text).not.toContain('redis://');
  });
});
