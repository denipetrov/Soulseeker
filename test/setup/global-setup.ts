import { MongoClient } from 'mongodb';
import { createClient } from 'redis';

import { TEST_DB_PREFIX, testMongoUri } from '../support/database.js';
import { deleteTestKeys, TEST_PREFIX_ROOT, testRedisUrl } from '../support/redis.js';

/**
 * Runs once per integration run, before any worker starts: fails readably when
 * MongoDB or Redis is not up — instead of every file timing out on connect —
 * and clears what a killed run left behind.
 */
export async function setup(): Promise<void> {
  await assertMongo();
  await assertRedis();
  await cleanUp();
}

/** Runs once after every file has finished. Best effort. */
export async function teardown(): Promise<void> {
  try {
    await cleanUp();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[test] could not clean up after the run: ${reason}`);
  }
}

async function assertMongo(): Promise<void> {
  const uri = testMongoUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });

  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Integration tests need MongoDB at ${uri}, which is not reachable (${reason}). ` +
        'Start Rankwarden\'s, or "npm run db:up:standalone", or set TEST_MONGODB_URI.',
      { cause: error },
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function assertRedis(): Promise<void> {
  const url = testRedisUrl();
  const client = createClient({ url, socket: { connectTimeout: 5_000, reconnectStrategy: false } });
  client.on('error', () => undefined);

  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Integration tests need Redis at ${url}, which is not reachable (${reason}). ` +
        'Start it with "npm run db:up", or set TEST_REDIS_URL.',
      { cause: error },
    );
  } finally {
    if (client.isOpen) await client.close();
  }
}

/** Drops every `soulseeker_test_*` database and every `sstest_*` key, and only those. */
async function cleanUp(): Promise<void> {
  const client = new MongoClient(testMongoUri(), { serverSelectionTimeoutMS: 5_000 });

  try {
    await client.connect();
    const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });

    for (const { name } of databases) {
      if (name.startsWith(TEST_DB_PREFIX)) await client.db(name).dropDatabase();
    }
  } finally {
    await client.close();
  }

  await deleteTestKeys(TEST_PREFIX_ROOT);
}
