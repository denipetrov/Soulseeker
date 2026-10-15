/**
 * Runs before any test module is imported, so `ConfigModule.forRoot()` — which
 * reads `.env` the moment `app.module.ts` is imported — never sees the
 * developer's own configuration. `bootTestApp` then lays each file's own
 * settings over these.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Placeholders. The Blizzard token provider is replaced at the seam, and a real
// credential must never leak in from .env.
process.env.BLIZZARD_CLIENT_ID = 'test-client-id';
process.env.BLIZZARD_CLIENT_SECRET = 'test-client-secret';
process.env.RAIDER_IO_API_KEY = 'test-raiderio-key';

// Nothing here may reach a real upstream. Until `bootTestApp` points them at
// the fake, every host is a dead local port: a missed seam fails fast and
// locally instead of spending real quota.
process.env.BLIZZARD_API_HOST_TEMPLATE = 'http://127.0.0.1:9/{region}';
process.env.RAIDERIO_API_BASE_URL = 'http://127.0.0.1:9/raiderio';
process.env.RANKWARDEN_BASE_URL = 'http://127.0.0.1:9/rankwarden';
process.env.TURNSTILE_VERIFY_URL = 'http://127.0.0.1:9/turnstile';
