import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';
import type { RaidDifficulty } from '@denipetrov/spirit-link/constants';

import { BudgetSpentException } from '../../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import { describeError } from '../../common/utils/errors.js';
import { SingleFlight } from '../../common/utils/single-flight.js';
import type { Env } from '../../config/env.schema.js';
import { RaiderIoGuildApi } from '../../raiderio/guild.api.js';
import { CacheService } from '../../redis/cache.service.js';
import { RefreshCooldown } from '../../redis/refresh-cooldown.service.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import type { GuildQuery } from './dto/guild-query.dto.js';
import {
  bossKillPartOf,
  guildBaseOf,
  membersOf,
  raidEncountersFields,
  raidEncountersPartOf,
  ROSTER_FIELDS,
  SUMMARY_FIELDS,
  summaryPartOf,
} from './guild.mapper.js';
import type {
  BossKillPart,
  GuildBossKillResponse,
  GuildRaidEncountersResponse,
  GuildResponse,
  GuildRosterResponse,
  GuildSummaryResponse,
  RaidEncountersPart,
  SummaryPart,
} from './guild.types.js';

/** A cached part and whether it was served past its freshness. */
interface Served<T> {
  part: T;
  stale: boolean;
}

/**
 * Guild pages, from Raider.io through Redis. One widget per call:
 *
 * - **summary** — progression, rankings, and the members of ranks 0 and 1:
 *   `guild:<region>:<realm>:<name>:summary`, fresh `GUILD_CACHE_TTL_SECONDS`;
 * - **raid encounters** — one raid's bosses killed on one difficulty:
 *   `…:raid:<raid>:<difficulty>`, same TTL;
 * - **boss kill** — the guild's kill of one boss, with the full roster as
 *   Raider.io returns it (~870 KB): `…:boss:<raid>:<boss>:<difficulty>`, fresh
 *   `GUILD_BOSS_KILL_CACHE_TTL_SECONDS` since a kill does not change. A boss not
 *   killed yet is kept only `GUILD_CACHE_TTL_SECONDS`: the guild may kill it;
 * - **full roster** — every member (~1,000 for a large guild), never cached.
 *
 * Cached parts are kept `GUILD_STALE_SECONDS` past their freshness, to be served
 * stale when the budget is spent.
 */
@Injectable()
export class GuildService {
  private readonly logger = new RunLogger(GuildService.name);
  private readonly ttlMs: number;
  private readonly bossKillTtlMs: number;
  private readonly staleSeconds: number;
  private readonly cooldownSeconds: number;
  /** One Raider.io request per key at a time on this replica. */
  private readonly flights = new SingleFlight();

  constructor(
    private readonly raiderIo: RaiderIoGuildApi,
    private readonly catalogue: PveCatalogue,
    private readonly cache: CacheService,
    private readonly cooldown: RefreshCooldown,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('GUILD_CACHE_TTL_SECONDS', { infer: true }) * 1000;
    this.bossKillTtlMs = config.get('GUILD_BOSS_KILL_CACHE_TTL_SECONDS', { infer: true }) * 1000;
    this.staleSeconds = config.get('GUILD_STALE_SECONDS', { infer: true });
    this.cooldownSeconds = config.get('GUILD_REFRESH_COOLDOWN_SECONDS', { infer: true });
  }

  async guild(query: GuildQuery): Promise<GuildResponse> {
    await this.assertKnownSlugs(query);

    const id = `${query.region}:${query.realmSlug}:${query.guildName}`;
    const label = `${query.region}/${query.realmSlug}/${query.guildName}`;

    if (query.showFullRoster) return this.roster(query, id, label);

    const forced =
      query.forceRefresh && (await this.cooldown.claim(`guild:${id}`, this.cooldownSeconds));

    if (query.raidEncounters && query.boss) {
      return this.bossKill(query, id, label, forced, query.raidEncounters, query.boss);
    }
    if (query.raidEncounters) {
      return this.raidEncounters(query, id, label, forced, query.raidEncounters);
    }

    return this.summary(query, id, label, forced);
  }

  private async summary(
    query: GuildQuery,
    id: string,
    label: string,
    forced: boolean,
  ): Promise<GuildSummaryResponse> {
    const { part, stale } = await this.served<SummaryPart>(
      `guild:${id}:summary`,
      label,
      forced,
      () => this.ttlMs,
      async () => {
        const payload = await this.raiderIo.getProfile(
          query.region,
          query.realmSlug,
          query.guildName,
          SUMMARY_FIELDS,
        );
        return payload && summaryPartOf(payload, new Date());
      },
    );

    return {
      region: query.region,
      realmSlug: query.realmSlug,
      guild: part.guild,
      raidProgression: part.raidProgression,
      raidRankings: part.raidRankings,
      members: part.members,
      fetchedAt: part.fetchedAt,
      stale,
    };
  }

  private async raidEncounters(
    query: GuildQuery,
    id: string,
    label: string,
    forced: boolean,
    raid: string,
  ): Promise<GuildRaidEncountersResponse> {
    const difficulty = query.difficulty!;
    const { part, stale } = await this.served<RaidEncountersPart>(
      `guild:${id}:raid:${raid}:${difficulty}`,
      label,
      forced,
      () => this.ttlMs,
      async () => {
        const payload = await this.raiderIo.getProfile(
          query.region,
          query.realmSlug,
          query.guildName,
          raidEncountersFields(raid, difficulty),
        );
        return payload && raidEncountersPartOf(payload, new Date());
      },
    );

    return {
      region: query.region,
      realmSlug: query.realmSlug,
      guild: part.guild,
      raid,
      difficulty,
      encounters: part.encounters,
      fetchedAt: part.fetchedAt,
      stale,
    };
  }

  private async bossKill(
    query: GuildQuery,
    id: string,
    label: string,
    forced: boolean,
    raid: string,
    boss: string,
  ): Promise<GuildBossKillResponse> {
    const difficulty: RaidDifficulty = query.difficulty!;
    const { part, stale } = await this.served<BossKillPart>(
      `guild:${id}:boss:${raid}:${boss}:${difficulty}`,
      label,
      forced,
      // A kill is history; a boss not killed yet may be killed any day.
      (cached) => (cached.kill ? this.bossKillTtlMs : this.ttlMs),
      async () => {
        const payload = await this.raiderIo.getBossKill(
          query.region,
          query.realmSlug,
          query.guildName,
          raid,
          boss,
          difficulty,
        );
        return payload && bossKillPartOf(payload, new Date());
      },
    );

    return {
      region: query.region,
      realmSlug: query.realmSlug,
      guildName: query.guildName,
      raid,
      boss,
      difficulty,
      kill: part.kill,
      roster: part.roster,
      fetchedAt: part.fetchedAt,
      stale,
    };
  }

  /**
   * Every member. Never cached — a large guild's roster is ~350 KB and asked
   * for rarely — so every call is one Raider.io request; concurrent calls for
   * the same guild on a replica share it.
   */
  private async roster(query: GuildQuery, id: string, label: string): Promise<GuildRosterResponse> {
    let payload;
    try {
      payload = await this.flights.run(`guild:${id}:roster`, () =>
        this.raiderIo.getProfile(query.region, query.realmSlug, query.guildName, ROSTER_FIELDS),
      );
    } catch (error) {
      throw this.unavailable(label, error);
    }

    if (!payload) throw new NotFoundException('No such guild');

    return {
      region: query.region,
      realmSlug: query.realmSlug,
      guild: guildBaseOf(payload),
      members: membersOf(payload),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }

  /**
   * A part from the cache while fresh, otherwise from Raider.io and cached
   * again. When Raider.io cannot be asked, the kept copy however old;
   * without one, 503 for a spent budget and 502 for anything else. A guild
   * Raider.io does not know is a 404 and nothing is cached.
   */
  private async served<T extends { fetchedAt: string }>(
    key: string,
    label: string,
    forced: boolean,
    ttlMsOf: (part: T) => number,
    load: () => Promise<T | null>,
  ): Promise<Served<T>> {
    const cached = await this.cache.get<T>(key);
    if (cached && !forced && Date.now() - Date.parse(cached.fetchedAt) < ttlMsOf(cached)) {
      return { part: cached, stale: false };
    }

    let part: T | null;
    try {
      part = await this.flights.run(key, load);
    } catch (error) {
      if (cached) {
        this.logger.warn(`Serving ${label} stale: ${describeError(error)}`);
        return { part: cached, stale: true };
      }
      throw this.unavailable(label, error);
    }

    if (!part) throw new NotFoundException('No such guild');

    await this.cache.set(key, part, Math.ceil(ttlMsOf(part) / 1000) + this.staleSeconds);

    return { part, stale: false };
  }

  private unavailable(label: string, error: unknown): Error {
    const spent = budgetErrorOf(error);
    if (spent) {
      this.logger.warn(`No answer for ${label}: ${spent.message}`);
      return new BudgetSpentException('Raider.io');
    }

    this.logger.warn(`Raider.io lookup of ${label} failed: ${describeError(error)}`);
    return new BadGatewayException('Raider.io could not be reached; retry later.');
  }

  /** A raid or boss the catalogue does not hold is a 400, not a Raider.io request. */
  private async assertKnownSlugs(query: GuildQuery): Promise<void> {
    if (!query.raidEncounters) return;

    const raid = await this.catalogue.raid(query.raidEncounters);
    const issues: { path: string; message: string }[] = [];

    if (!raid) {
      issues.push({ path: 'raidEncounters', message: 'is not a known raid' });
    } else if (query.boss && !raid.encounters.some((encounter) => encounter.slug === query.boss)) {
      issues.push({ path: 'boss', message: `is not a boss of ${raid.slug}` });
    }

    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid guild query', issues });
    }
  }
}
