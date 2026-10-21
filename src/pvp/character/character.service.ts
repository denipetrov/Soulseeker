import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger, withRunId } from '@denipetrov/spirit-link/logging';

import { RunKind } from '../../common/logging/run-kind.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import type { Env } from '../../config/env.schema.js';
import { RankwardenSyncClient } from '../../rankwarden/rankwarden-sync.client.js';
import { CacheService } from '../../redis/cache.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { CharacterLoader, type CharacterRef } from './character.loader.js';
import { responseOf, syncPayloadOf } from './character.mapper.js';
import type { CorePart, LocalizedPart, PvpCharacterResponse } from './character.types.js';
import type { CharacterQuery } from './dto/character-query.dto.js';

/**
 * How long a client should wait after a 503. Blizzard's hour is counted in
 * one-minute buckets, so a minute frees the oldest of them.
 */
export const BUDGET_RETRY_AFTER_SECONDS = 60;

/** A 503 that knows its Retry-After. */
export class BudgetSpentException extends ServiceUnavailableException {
  constructor(readonly retryAfterSeconds = BUDGET_RETRY_AFTER_SECONDS) {
    super('The Blizzard request budget is spent and this character is not cached; retry later.');
  }
}

/**
 * PvP character pages, from Blizzard through Redis.
 *
 * A page is cached in two parts, so a second language costs 3 requests rather
 * than all ~13:
 *
 * - `pvp:character:<region>:<realm>:<name>:core` — ratings, stats, render URLs
 *   and the PvP history, the same in every language;
 * - `…:<name>:locale:<locale>` — profile, talents and equipment.
 *
 * Each part is fresh for `PVP_CHARACTER_CACHE_TTL_SECONDS` and kept in Redis
 * for `PVP_CHARACTER_STALE_SECONDS` more, so when the budget is spent an
 * expired page is still served, marked `stale`. Freshness is the part's own
 * `fetchedAt`, not the Redis TTL.
 *
 * Every time the core part is fetched fresh, the ratings and profile are
 * pushed to Rankwarden once the response has gone.
 */
@Injectable()
export class PvpCharacterService {
  private readonly logger = new RunLogger(PvpCharacterService.name);
  private readonly ttlMs: number;
  private readonly keepSeconds: number;
  private readonly cooldownSeconds: number;
  /** In-process single flight: one Blizzard load per part at a time on this replica. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly loader: CharacterLoader,
    private readonly cache: CacheService,
    private readonly redis: RedisService,
    private readonly sync: RankwardenSyncClient,
    config: ConfigService<Env, true>,
  ) {
    const ttlSeconds = config.get('PVP_CHARACTER_CACHE_TTL_SECONDS', { infer: true });
    this.ttlMs = ttlSeconds * 1000;
    this.keepSeconds = ttlSeconds + config.get('PVP_CHARACTER_STALE_SECONDS', { infer: true });
    this.cooldownSeconds = config.get('PVP_CHARACTER_REFRESH_COOLDOWN_SECONDS', { infer: true });
  }

  async character(query: CharacterQuery): Promise<PvpCharacterResponse> {
    const ref: CharacterRef = {
      region: query.region,
      realmSlug: query.realmSlug,
      characterName: query.characterName,
    };
    const id = `${ref.region}:${ref.realmSlug}:${ref.characterName}`;
    const coreKey = `pvp:character:${id}:core`;
    const localizedKey = `pvp:character:${id}:locale:${query.locale}`;

    const [cachedCore, cachedLocalized] = (await this.cache.getMany<CorePart | LocalizedPart>([
      coreKey,
      localizedKey,
    ])) as [CorePart | null, LocalizedPart | null];

    const forced = query.forceRefresh && (await this.claimRefresh(id));
    const needCore = forced || !this.isFresh(cachedCore);
    const needLocalized = forced || !this.isFresh(cachedLocalized);

    if (!needCore && !needLocalized) {
      return responseOf(ref.region, cachedCore!, cachedLocalized!, false);
    }

    let core: CorePart;
    let localized: LocalizedPart | null;

    try {
      [core, localized] = await Promise.all([
        needCore ? this.once(coreKey, () => this.loader.core(ref)) : cachedCore!,
        needLocalized
          ? this.once(localizedKey, () => this.loader.localized(ref, query.locale))
          : cachedLocalized,
      ]);
    } catch (error) {
      return this.fallback(ref, cachedCore, cachedLocalized, error);
    }

    if (!localized) throw new NotFoundException('No such character');

    const fresh = new Map<string, unknown>();
    if (needCore) fresh.set(coreKey, core);
    if (needLocalized) fresh.set(localizedKey, localized);
    await this.cache.setMany(fresh, this.keepSeconds);

    if (needCore) this.pushAfterResponse(ref, core, localized);

    return responseOf(ref.region, core, localized, false);
  }

  private isFresh(part: { fetchedAt: string } | null): boolean {
    return part !== null && Date.now() - Date.parse(part.fetchedAt) < this.ttlMs;
  }

  /**
   * Whether a forced refresh may go to Blizzard now: once per character per
   * cooldown, across replicas. Fails closed — without Redis the budget could
   * not be charged anyway.
   */
  private async claimRefresh(id: string): Promise<boolean> {
    try {
      const claimed = await this.redis.client.set(
        this.redis.key('pvp', 'character', 'refresh', id),
        '1',
        { condition: 'NX', expiration: { type: 'EX', value: this.cooldownSeconds } },
      );

      return claimed === 'OK';
    } catch (error) {
      this.logger.warn(`Refresh cooldown unavailable: ${describeError(error)}`);
      return false;
    }
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const started = load().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);

    return started;
  }

  /**
   * Blizzard could not be asked: the expired page if both parts are still
   * kept, otherwise 503 for a spent budget and 502 for anything else.
   */
  private fallback(
    ref: CharacterRef,
    core: CorePart | null,
    localized: LocalizedPart | null,
    error: unknown,
  ): PvpCharacterResponse {
    const spent = budgetErrorOf(error);
    const id = `${ref.region}/${ref.realmSlug}/${ref.characterName}`;

    if (core && localized) {
      this.logger.warn(`Serving ${id} stale: ${describeError(error)}`);
      return responseOf(ref.region, core, localized, true);
    }

    if (spent) {
      this.logger.warn(`No page for ${id}: ${spent.message}`);
      throw new BudgetSpentException();
    }

    this.logger.warn(`Blizzard lookup of ${id} failed: ${describeError(error)}`);
    throw new BadGatewayException('Blizzard could not be reached; retry later.');
  }

  /**
   * Hands the fresh ratings to Rankwarden. Started on the next turn of the
   * event loop, after the response is on its way; the sync client never
   * throws, and a 409 can keep it retrying for a while.
   */
  private pushAfterResponse(ref: CharacterRef, core: CorePart, localized: LocalizedPart): void {
    const payload = syncPayloadOf(ref.region, core, localized);
    if (!payload) return;

    setImmediate(() => {
      void withRunId(RunKind.Sync, async () => {
        const outcome = await this.sync.pushPvpCharacter(payload);
        this.logger.debug(
          `Sync ${ref.region}/${ref.realmSlug}/${ref.characterName}: ${outcome.status}`,
        );
      });
    });
  }
}
