import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger, withRunId } from '@denipetrov/spirit-link/logging';

import { RunKind } from '../../common/logging/run-kind.js';
import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import { SingleFlight } from '../../common/utils/single-flight.js';
import type { Env } from '../../config/env.schema.js';
import { RaiderIoCharacterApi } from '../../raiderio/character.api.js';
import type { RaiderIoCharacterPayload } from '../../raiderio/schemas/character-profile.schema.js';
import { RankwardenSyncClient } from '../../rankwarden/rankwarden-sync.client.js';
import { CacheService } from '../../redis/cache.service.js';
import { RefreshCooldown } from '../../redis/refresh-cooldown.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import {
  FULL_FIELDS,
  fullPartOf,
  raidFields,
  raidPartOf,
  responseOf,
  seasonFields,
  seasonPartOf,
  syncPayloadOf,
  type AnswerParts,
} from './character.mapper.js';
import type { PveCharacterResponse } from './character.types.js';
import type { PveCharacterQuery } from './dto/character-query.dto.js';

type PartName = keyof AnswerParts;

/**
 * PvE character pages, from Raider.io through Redis.
 *
 * Each answer is built from cached parts, so a widget asking for one raid or
 * one season does not pay for the whole page, and the whole page does not
 * pay for a widget:
 *
 * - `pve:character:<region>:<realm>:<name>:full` — every field;
 * - `…:raid:<slug>` — one raid's progression and AOTC / Cutting Edge dates;
 * - `…:season:<slug>` — one Mythic+ season's scores.
 *
 * The parts missing or expired are fetched together, in one Raider.io request
 * with all their fields. A part is fresh for `PVE_CHARACTER_CACHE_TTL_SECONDS`
 * and kept `PVE_CHARACTER_STALE_SECONDS` longer, to serve stale when the
 * budget is spent.
 *
 * Every time the whole page is fetched fresh, the current season's best runs
 * are pushed to Rankwarden once the response has gone.
 */
@Injectable()
export class PveCharacterService {
  private readonly logger = new RunLogger(PveCharacterService.name);
  private readonly ttlMs: number;
  private readonly keepSeconds: number;
  private readonly cooldownSeconds: number;
  /** One Raider.io request per set of parts at a time on this replica. */
  private readonly flights = new SingleFlight();

  constructor(
    private readonly raiderIo: RaiderIoCharacterApi,
    private readonly catalogue: PveCatalogue,
    private readonly cache: CacheService,
    private readonly cooldown: RefreshCooldown,
    private readonly sync: RankwardenSyncClient,
    config: ConfigService<Env, true>,
  ) {
    const ttlSeconds = config.get('PVE_CHARACTER_CACHE_TTL_SECONDS', { infer: true });
    this.ttlMs = ttlSeconds * 1000;
    this.keepSeconds = ttlSeconds + config.get('PVE_CHARACTER_STALE_SECONDS', { infer: true });
    this.cooldownSeconds = config.get('PVE_CHARACTER_REFRESH_COOLDOWN_SECONDS', { infer: true });
  }

  async character(query: PveCharacterQuery): Promise<PveCharacterResponse> {
    await this.assertKnownSlugs(query);

    const id = `${query.region}:${query.realmSlug}:${query.characterName}`;
    const keys: Partial<Record<PartName, string>> = {};
    if (query.raidProgression) keys.raid = `pve:character:${id}:raid:${query.raidProgression}`;
    if (query.mplusSeasonScore) {
      keys.season = `pve:character:${id}:season:${query.mplusSeasonScore}`;
    }
    if (!keys.raid && !keys.season) keys.full = `pve:character:${id}:full`;

    const names = Object.keys(keys) as PartName[];
    const values = await this.cache.getMany<AnswerParts[PartName]>(
      names.map((name) => keys[name]!),
    );
    const cached: AnswerParts = Object.fromEntries(
      names.flatMap((name, i) => (values[i] ? [[name, values[i]]] : [])),
    );

    const forced =
      query.forceRefresh &&
      (await this.cooldown.claim(`pve:character:${id}`, this.cooldownSeconds));
    const missing = names.filter((name) => forced || !this.isFresh(cached[name]));

    if (missing.length === 0) return responseOf(query.region, query.realmSlug, cached, false);

    const fields = missing.flatMap((name) =>
      name === 'full'
        ? [...FULL_FIELDS]
        : name === 'raid'
          ? raidFields(query.raidProgression!)
          : seasonFields(query.mplusSeasonScore!),
    );

    let payload: RaiderIoCharacterPayload | null;
    const fetchedAt = new Date();
    try {
      payload = await this.flights.run(`${id}|${fields.join(',')}`, () =>
        this.raiderIo.getProfile(query.region, query.realmSlug, query.characterName, fields),
      );
    } catch (error) {
      return this.fallback(query, names, cached, error);
    }

    if (!payload) throw new NotFoundException('No such character');

    const fresh: AnswerParts = {};
    if (missing.includes('full')) fresh.full = fullPartOf(payload, fetchedAt);
    if (missing.includes('raid')) {
      fresh.raid = raidPartOf(payload, query.raidProgression!, fetchedAt);
    }
    if (missing.includes('season')) fresh.season = seasonPartOf(payload, fetchedAt);

    await this.cache.setMany(
      new Map(missing.map((name) => [keys[name]!, fresh[name]])),
      this.keepSeconds,
    );

    if (fresh.full) this.pushAfterResponse(query, payload);

    return responseOf(query.region, query.realmSlug, { ...cached, ...fresh }, false);
  }

  private isFresh(part: { fetchedAt: string } | undefined): boolean {
    return part !== undefined && Date.now() - Date.parse(part.fetchedAt) < this.ttlMs;
  }

  /** A raid or season the catalogue does not hold is a 400, not a Raider.io request. */
  private async assertKnownSlugs(query: PveCharacterQuery): Promise<void> {
    const issues: { path: string; message: string }[] = [];

    if (query.raidProgression && !(await this.catalogue.raid(query.raidProgression))) {
      issues.push({ path: 'raidProgression', message: 'is not a known raid' });
    }
    if (query.mplusSeasonScore && !(await this.catalogue.mplusSeason(query.mplusSeasonScore))) {
      issues.push({ path: 'mplusSeasonScore', message: 'is not a known Mythic+ season' });
    }

    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid character query', issues });
    }
  }

  /**
   * Raider.io could not be asked: the expired parts if every one asked for is
   * still kept, otherwise 503 for a spent budget and 502 for anything else.
   */
  private fallback(
    query: PveCharacterQuery,
    names: PartName[],
    cached: AnswerParts,
    error: unknown,
  ): PveCharacterResponse {
    const spent = budgetErrorOf(error);
    const id = `${query.region}/${query.realmSlug}/${query.characterName}`;

    if (names.every((name) => cached[name])) {
      this.logger.warn(`Serving ${id} stale: ${describeError(error)}`);
      return responseOf(query.region, query.realmSlug, cached, true);
    }

    if (spent) {
      this.logger.warn(`No page for ${id}: ${spent.message}`);
      throw new BudgetSpentException('Raider.io');
    }

    this.logger.warn(`Raider.io lookup of ${id} failed: ${describeError(error)}`);
    throw new BadGatewayException('Raider.io could not be reached; retry later.');
  }

  /**
   * Hands the current season's best runs to Rankwarden, on the next turn of the
   * event loop, after the response is on its way. The sync client never throws.
   */
  private pushAfterResponse(query: PveCharacterQuery, payload: RaiderIoCharacterPayload): void {
    const label = `${query.region}/${query.realmSlug}/${query.characterName}`;

    setImmediate(() => {
      void withRunId(RunKind.Sync, async () => {
        try {
          const season = payload.mythic_plus_scores_by_season?.[0]?.season;
          const dungeonIds = season ? (await this.catalogue.mplusSeason(season))?.dungeonIds : null;
          if (!dungeonIds) return;

          const body = syncPayloadOf(query.region, query.realmSlug, payload, dungeonIds);
          if (!body) return;

          const outcome = await this.sync.pushMplusCharacter(body);
          this.logger.debug(`Sync ${label}: ${outcome.status}`);
        } catch (error) {
          this.logger.warn(`Sync ${label} not sent: ${describeError(error)}`);
        }
      });
    });
  }
}
