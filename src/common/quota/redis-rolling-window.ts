import type { RedisClient } from '../../redis/redis.service.js';

/** One ceiling: at most `limit` requests in any `windowMs`, counted in `buckets` slices. */
export interface WindowSpec {
  /** Short name used in keys and reports, e.g. `hour` or `second`. */
  name: string;
  windowMs: number;
  /** How finely the window is sliced. More buckets: a smoother roll, a longer MGET. */
  buckets: number;
  limit: number;
}

export interface ConsumeResult {
  ok: boolean;
  /** The window that refused, when `ok` is false. */
  refusedBy: WindowSpec | null;
}

/**
 * Checks every window, and only if all of them have room charges all of them.
 * Atomic, so two replicas can never both take the last slot.
 *
 * Each window is a ring of counters, one key per bucket, each expiring once it
 * has rolled out of the window. A sorted set per request would be exact, but
 * 32,400 members an hour per provider is a lot of memory for a precision
 * nobody needs: a bucket is 1/60th of the window here.
 */
const CONSUME_SCRIPT = `
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local prefix = ARGV[3]
local count = (#ARGV - 3) / 4
local current = {}

for i = 0, count - 1 do
  local name = ARGV[4 + i * 4]
  local bucketMs = tonumber(ARGV[5 + i * 4])
  local buckets = tonumber(ARGV[6 + i * 4])
  local limit = tonumber(ARGV[7 + i * 4])
  local slot = math.floor(now / bucketMs)
  local keys = {}

  for b = slot - buckets + 1, slot do
    keys[#keys + 1] = prefix .. name .. ':' .. b
  end

  local sum = 0
  for _, value in ipairs(redis.call('MGET', unpack(keys))) do
    if value then sum = sum + tonumber(value) end
  end

  if sum + cost > limit then
    return i
  end

  current[i + 1] = { prefix .. name .. ':' .. slot, bucketMs * (buckets + 1) }
end

for _, entry in ipairs(current) do
  redis.call('INCRBY', entry[1], cost)
  redis.call('PEXPIRE', entry[1], entry[2])
end

return -1
`;

function bucketMs(window: WindowSpec): number {
  return Math.max(1, Math.floor(window.windowMs / window.buckets));
}

/** A set of request ceilings for one upstream, shared through Redis by every replica. */
export class RedisRollingWindow {
  constructor(
    private readonly redis: RedisClient,
    /** Key prefix for this upstream, e.g. `ss:budget:blizzard:`. */
    private readonly prefix: string,
    readonly windows: readonly WindowSpec[],
  ) {
    if (windows.length === 0) throw new RangeError('at least one window is required');
  }

  async tryConsume(cost = 1, now = Date.now()): Promise<ConsumeResult> {
    const args = [String(now), String(cost), this.prefix];

    for (const window of this.windows) {
      args.push(
        window.name,
        String(bucketMs(window)),
        String(window.buckets),
        String(window.limit),
      );
    }

    const refused = Number(await this.redis.eval(CONSUME_SCRIPT, { keys: [], arguments: args }));

    return refused < 0
      ? { ok: true, refusedBy: null }
      : { ok: false, refusedBy: this.windows[refused] ?? null };
  }

  /** Requests counted in each window right now. Read-only. */
  async usage(now = Date.now()): Promise<Record<string, number>> {
    const usage: Record<string, number> = {};

    for (const window of this.windows) {
      const size = bucketMs(window);
      const slot = Math.floor(now / size);
      const keys = Array.from(
        { length: window.buckets },
        (_, index) => `${this.prefix}${window.name}:${slot - index}`,
      );
      const values = await this.redis.mGet(keys);

      usage[window.name] = values.reduce((sum, value) => sum + (value ? Number(value) : 0), 0);
    }

    return usage;
  }

  /** How long until the oldest bucket of `window` rolls out. */
  static retryAfterMs(window: WindowSpec): number {
    return bucketMs(window);
  }
}
