import { MongoClient, type Db } from 'mongodb';

/**
 * Every test database must carry this prefix.
 *
 * `ConfigModule` reads `.env`, where `MONGODB_DB` names Rankwarden's real
 * development database. Soulseeker never writes to it, but the tests seed
 * fixtures, so the name is checked rather than assumed.
 */
export const TEST_DB_PREFIX = 'soulseeker_test_';

export function testMongoUri(): string {
  return process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
}

/** A name unique to one test file, derived from its path: `soulseeker_test_auth`. */
export function testNameFor(testPath: string | undefined): string {
  return (testPath ?? `anon_${process.pid}`)
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .replace(/\.spec\.ts$/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .toLowerCase();
}

export function testDbName(testPath: string | undefined): string {
  return `${TEST_DB_PREFIX}${testNameFor(testPath)}`.slice(0, 60);
}

/** Refuses any database name that is not obviously a test one. */
export function assertTestDatabase(name: string): string {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `Refusing to run against database "${name}": test databases must start with ` +
        `"${TEST_DB_PREFIX}".`,
    );
  }

  return name;
}

/** A client on one test database, and a disposer that drops it. For seeding fixtures. */
export async function openTestDatabase(name: string): Promise<{
  db: Db;
  drop: () => Promise<void>;
}> {
  assertTestDatabase(name);
  const client = new MongoClient(testMongoUri());
  await client.connect();
  const db = client.db(name);

  return {
    db,
    drop: async () => {
      await db.dropDatabase();
      await client.close();
    },
  };
}
