import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger, withRunId } from '@denipetrov/spirit-link/logging';

import { RunKind } from '../../common/logging/run-kind.js';
import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import { SingleFlight } from '../../common/utils/single-flight.js';
import type { CharacterDocument } from '../../characters/entities/character.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import type { CharacterSyncInput } from '../../rankwarden/dto/character-sync.dto.js';
import { RankwardenSyncClient } from '../../rankwarden/rankwarden-sync.client.js';
import { CacheService } from '../../redis/cache.service.js';
import { RefreshCooldown } from '../../redis/refresh-cooldown.service.js';
import { CharacterLoader, type CharacterRef } from './character.loader.js';
import { responseOf, syncPayloadOf } from './character.mapper.js';
import type { CorePart, LocalizedPart, PvpCharacterResponse } from './character.types.js';
import type { CharacterQuery } from './dto/character-query.dto.js';

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
 * pushed to Rankwarden before the answer is completed: one attempt, briefly
 * waited on, because each ladder's `previousRating` is read back from
 * Rankwarden afterwards and the sync's write is what sets it. A busy
 * Rankwarden is retried in the background.
 */
@Injectable()
export class PvpCharacterService {
  private readonly logger = new RunLogger(PvpCharacterService.name);
  private readonly ttlMs: number;
  private readonly keepSeconds: number;
  private readonly cooldownSeconds: number;
  private readonly inlineSyncTimeoutMs: number;
  /** One Blizzard load per part at a time on this replica. */
  private readonly flights = new SingleFlight();

  constructor(
    private readonly loader: CharacterLoader,
    private readonly cache: CacheService,
    private readonly cooldown: RefreshCooldown,
    private readonly sync: RankwardenSyncClient,
    private readonly mongo: MongoService,
    config: ConfigService<Env, true>,
  ) {
    const ttlSeconds = config.get('PVP_CHARACTER_CACHE_TTL_SECONDS', { infer: true });
    this.ttlMs = ttlSeconds * 1000;
    this.keepSeconds = ttlSeconds + config.get('PVP_CHARACTER_STALE_SECONDS', { infer: true });
    this.cooldownSeconds = config.get('PVP_CHARACTER_REFRESH_COOLDOWN_SECONDS', { infer: true });
    this.inlineSyncTimeoutMs = config.get('RANKWARDEN_SYNC_INLINE_TIMEOUT_MS', { infer: true });
  }

  async character(query: CharacterQuery): Promise<PvpCharacterResponse> {
    const { response, sync } = await this.page(query);

    // Before reading back: the sync's write is what turns the stored rating
    // into `previousRating`, so the answer must see it to be current.
    if (sync) await this.syncBeforeReading(sync);

    return this.withStandings(response);
  }

  /**
   * Each ladder's rank and previous rating, as Rankwarden holds them. Blizzard's
   * per-ladder endpoint has neither, and both move every hour, so they are read
   * from MongoDB on every answer rather than cached: one indexed lookup by
   * `character_identity`. A failed read leaves them null instead of failing
   * the page.
   */
  private async withStandings(response: PvpCharacterResponse): Promise<PvpCharacterResponse> {
    if (response.seasonId === null || response.brackets.length === 0) return response;

    let stored: Pick<CharacterDocument, 'brackets'> | null;
    try {
      stored = await this.mongo.collection<CharacterDocument>(Collections.Characters).findOne(
        {
          seasonId: response.seasonId,
          region: response.region,
          characterId: response.character.id,
        },
        {
          projection: Object.fromEntries([
            ['_id', 0],
            ...response.brackets.flatMap(({ bracket }) => [
              [`brackets.${bracket}.rank`, 1],
              [`brackets.${bracket}.previousRating`, 1],
            ]),
          ]),
        },
      );
    } catch (error) {
      this.logger.warn(`Ranks of ${response.character.name} not read: ${describeError(error)}`);
      return response;
    }

    return {
      ...response,
      brackets: response.brackets.map((entry) => ({
        ...entry,
        rank: stored?.brackets?.[entry.bracket]?.rank ?? null,
        previousRating: stored?.brackets?.[entry.bracket]?.previousRating ?? null,
      })),
    };
  }

  /**
   * One attempt at the sync, waited on but briefly (`RANKWARDEN_SYNC_INLINE_
   * TIMEOUT_MS`, no 409 retries), so the page reads Rankwarden after it.
   *
   * A busy Rankwarden (409: the sweep owns the documents) has written nothing,
   * so it is retried in the background with the usual backoff, and this answer
   * shows the standings as they were. Anything else is not retried: a timeout
   * may still have landed, and writing again would make the previous rating
   * the new one.
   */
  private async syncBeforeReading(sync: PendingSync): Promise<void> {
    const outcome = await withRunId(RunKind.Sync, () =>
      this.sync.pushPvpCharacter(sync.payload, {
        retries: 0,
        timeoutMs: this.inlineSyncTimeoutMs,
      }),
    );

    this.logger.debug(`Sync ${sync.id}: ${outcome.status}`);
    if (outcome.status === 'busy') this.retryAfterResponse(sync);
  }

  private async page(
    query: CharacterQuery,
  ): Promise<{ response: PvpCharacterResponse; sync: PendingSync | null }> {
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

    const forced =
      query.forceRefresh &&
      (await this.cooldown.claim(`pvp:character:${id}`, this.cooldownSeconds));
    const needCore = forced || !this.isFresh(cachedCore);
    const needLocalized = forced || !this.isFresh(cachedLocalized);

    if (!needCore && !needLocalized) {
      return { response: responseOf(ref.region, cachedCore!, cachedLocalized!, false), sync: null };
    }

    let core: CorePart;
    let localized: LocalizedPart | null;

    try {
      [core, localized] = await Promise.all([
        needCore ? this.flights.run(coreKey, () => this.loader.core(ref)) : cachedCore!,
        needLocalized
          ? this.flights.run(localizedKey, () => this.loader.localized(ref, query.locale))
          : cachedLocalized,
      ]);
    } catch (error) {
      return { response: this.fallback(ref, cachedCore, cachedLocalized, error), sync: null };
    }

    if (!localized) throw new NotFoundException('No such character');

    const fresh = new Map<string, unknown>();
    if (needCore) fresh.set(coreKey, core);
    if (needLocalized) fresh.set(localizedKey, localized);
    await this.cache.setMany(fresh, this.keepSeconds);

    // Fresh ratings are what Rankwarden is told about; a cached core part was
    // pushed when it was fetched.
    const payload = needCore ? syncPayloadOf(ref.region, core, localized) : null;

    return {
      response: responseOf(ref.region, core, localized, false),
      sync: payload ? { id: `${ref.region}/${ref.realmSlug}/${ref.characterName}`, payload } : null,
    };
  }

  private isFresh(part: { fetchedAt: string } | null): boolean {
    return part !== null && Date.now() - Date.parse(part.fetchedAt) < this.ttlMs;
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
      throw new BudgetSpentException('Blizzard');
    }

    this.logger.warn(`Blizzard lookup of ${id} failed: ${describeError(error)}`);
    throw new BadGatewayException('Blizzard could not be reached; retry later.');
  }

  /**
   * Retries a sync Rankwarden was too busy for, with the full backoff. Started
   * on the next turn of the event loop, after the response is on its way; the
   * sync client never throws.
   */
  private retryAfterResponse(sync: PendingSync): void {
    setImmediate(() => {
      void withRunId(RunKind.Sync, async () => {
        const outcome = await this.sync.pushPvpCharacter(sync.payload);
        this.logger.debug(`Sync ${sync.id} retried: ${outcome.status}`);
      });
    });
  }
}

/** Fresh ratings this answer has to hand to Rankwarden. */
interface PendingSync {
  /** `region/realm/name`, for log lines. */
  id: string;
  payload: CharacterSyncInput;
}
