import type { Adapter, AdapterPayload } from 'oidc-provider';

import type { RedisClient } from '../../redis/redis.service.js';

/** Models whose tokens are revoked together when their grant is. */
const GRANTABLE = new Set([
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'DeviceCode',
  'BackchannelAuthenticationRequest',
]);

/**
 * oidc-provider's storage on Redis: grants, refresh tokens, sessions and
 * interactions, under `<prefix>oidc:`.
 *
 * In Redis rather than memory because there is more than one replica: a
 * refresh token issued by one must be redeemable at another, and a grant
 * revoked on one must be revoked on all. Every entry carries the TTL the
 * provider gives it, so nothing outlives its token.
 *
 * Shaped after the reference adapter in oidc-provider's examples, on
 * node-redis. Payloads are JSON strings; `consume` rewrites one keeping its TTL.
 */
export function redisAdapterFactory(
  client: RedisClient,
  prefix: string,
): new (name: string) => Adapter {
  const grantKey = (grantId: string) => `${prefix}oidc:grant:${grantId}`;
  const userCodeKey = (userCode: string) => `${prefix}oidc:userCode:${userCode}`;
  const uidKey = (uid: string) => `${prefix}oidc:uid:${uid}`;

  return class RedisAdapter implements Adapter {
    constructor(private readonly name: string) {}

    private key(id: string): string {
      return `${prefix}oidc:${this.name}:${id}`;
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const key = this.key(id);
      const expiration =
        expiresIn > 0 ? { expiration: { type: 'EX' as const, value: expiresIn } } : {};
      const multi = client.multi();

      multi.set(key, JSON.stringify(payload), expiration);

      if (GRANTABLE.has(this.name) && payload.grantId) {
        // The grant's index lists every token issued under it, so a revocation
        // finds them all. It lives as long as its longest-lived token.
        const index = grantKey(payload.grantId);
        multi.rPush(index, key);

        const ttl = await client.ttl(index);
        if (expiresIn > 0 && expiresIn > ttl) multi.expire(index, expiresIn);
      }

      if (payload.userCode) multi.set(userCodeKey(payload.userCode), id, expiration);
      if (payload.uid) multi.set(uidKey(payload.uid), id, expiration);

      await multi.exec();
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const raw = await client.get(this.key(id));

      return raw ? (JSON.parse(raw) as AdapterPayload) : undefined;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const id = await client.get(userCodeKey(userCode));

      return id ? this.find(id) : undefined;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      const id = await client.get(uidKey(uid));

      return id ? this.find(id) : undefined;
    }

    async consume(id: string): Promise<void> {
      const payload = await this.find(id);
      if (!payload) return;

      payload.consumed = Math.floor(Date.now() / 1000);
      await client.set(this.key(id), JSON.stringify(payload), { expiration: 'KEEPTTL' });
    }

    async destroy(id: string): Promise<void> {
      await client.del(this.key(id));
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      const index = grantKey(grantId);
      const keys = await client.lRange(index, 0, -1);

      await client.del([...keys, index]);
    }
  };
}
