import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RaidBoardsDocument, RaidRankedGuild } from '../../characters/entities/raid.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import { PveCatalogue, type CatalogueRaid } from '../../seasons/pve-catalogue.service.js';
import { CURRENT_RAID } from '../bosses/dto/bosses-query.dto.js';
import { GuildRefs, type GuildRef } from '../shared/guild-refs.service.js';
import type { RaidQuery } from './dto/raid-query.dto.js';
import type { RaidRanking, RaidResponse } from './raid.types.js';

const iso = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;

/**
 * One raid's board: the top hundred guilds of a region (or `world`) at one
 * difficulty, from the `guilds` boards on Rankwarden's `raids`, each with its
 * guild from `guilds`.
 *
 * The raid itself — name, icon, bosses — comes from the catalogue; the board is
 * one read of the raid document by `slug` (`raid_slug`), projected to that one
 * board, so the other boards (up to fifteen of them, ~180 KB each) are never
 * read. Then the board's guilds through `GuildRefs`, in one read.
 *
 * Cached in Redis per region, raid and difficulty for
 * `RAID_BOARD_CACHE_TTL_SECONDS`.
 */
@Injectable()
export class RaidService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly catalogue: PveCatalogue,
    private readonly guildRefs: GuildRefs,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('RAID_BOARD_CACHE_TTL_SECONDS', { infer: true });
  }

  async raid(query: RaidQuery): Promise<RaidResponse> {
    const raid =
      query.raidSlug === CURRENT_RAID
        ? await this.catalogue.currentRaid()
        : await this.catalogue.raid(query.raidSlug);
    if (!raid) {
      throw new NotFoundException({
        message:
          query.raidSlug === CURRENT_RAID
            ? 'No current raid in the catalogue'
            : `No raid ${query.raidSlug} in the catalogue`,
      });
    }

    const key = ['pve:raid', query.region, raid.slug, query.difficulty].join(':');
    const response = await this.cache.getOrLoad(
      key,
      () => this.load(raid, query),
      this.cacheTtlSeconds,
    );

    return response!;
  }

  private async load(raid: CatalogueRaid, query: RaidQuery): Promise<RaidResponse> {
    const { region, difficulty } = query;
    const doc = await this.mongo.collection<RaidBoardsDocument>(Collections.Raids).findOne(
      { slug: raid.slug },
      {
        projection: {
          _id: 0,
          [`guilds.${region}.${difficulty}`]: 1,
          [`guildsUpdatedAt.${region}.${difficulty}`]: 1,
        },
      },
    );

    const board = [...(doc?.guilds?.[region]?.[difficulty] ?? [])].sort((a, b) => a.rank - b.rank);
    const guildOf = await this.guildRefs.byIds(board.map((row) => row.guildId));

    return {
      region,
      difficulty,
      raid: { slug: raid.slug, name: raid.name, icon: raid.icon, encounters: raid.encounters },
      updatedAt: iso(doc?.guildsUpdatedAt?.[region]?.[difficulty]),
      guilds: board.map((row) => ranking(row, guildOf(row.guildId))),
    };
  }
}

function ranking(row: RaidRankedGuild, guild: GuildRef): RaidRanking {
  return {
    rank: row.rank,
    regionRank: row.regionRank ?? null,
    guild,
    encountersPulled: (row.encountersPulled ?? []).map((pull) => ({
      encounterId: pull.encounterId ?? null,
      slug: pull.slug,
      numPulls: pull.numPulls ?? null,
      pullStartedAt: iso(pull.pullStartedAt),
      bestPercent: pull.bestPercent ?? null,
      isDefeated: pull.isDefeated,
    })),
    encountersDefeated: (row.encountersDefeated ?? []).map((kill) => ({
      encounterId: kill.encounterId ?? null,
      slug: kill.slug,
      firstDefeated: iso(kill.firstDefeated),
      lastDefeated: iso(kill.lastDefeated),
    })),
  };
}
