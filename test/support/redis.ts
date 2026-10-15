import { createClient } from 'redis';

/** Every test key prefix starts with this, so a cleanup can never touch real keys. */
export const TEST_PREFIX_ROOT = 'sstest_';

export function testRedisUrl(): string {
  return process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
}

/** The key prefix of one test file: `sstest_auth:`. */
export function testRedisPrefix(name: string): string {
  return `${TEST_PREFIX_ROOT}${name}:`;
}

/** Deletes every key under `pattern`, which must be a test prefix. */
export async function deleteTestKeys(pattern: string): Promise<number> {
  if (!pattern.startsWith(TEST_PREFIX_ROOT)) {
    throw new Error(`Refusing to delete Redis keys outside "${TEST_PREFIX_ROOT}*": ${pattern}`);
  }

  const client = createClient({ url: testRedisUrl() });
  await client.connect();

  try {
    let deleted = 0;
    for await (const keys of client.scanIterator({ MATCH: `${pattern}*`, COUNT: 500 })) {
      if (keys.length > 0) deleted += await client.del(keys);
    }

    return deleted;
  } finally {
    await client.close();
  }
}
