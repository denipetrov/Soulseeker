import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BOSS_DIFFICULTIES,
  type BossDifficulty,
  type BossDocument,
  type BossRankedGuild,
} from '../../characters/entities/boss.entity.js';
import type { Env } from '../../config/env.schema.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { CacheService } from '../../redis/cache.service.js';
import {
  PveCatalogue,
  type CatalogueRaid,
  type RaidEncounter,
} from '../../seasons/pve-catalogue.service.js';
import { GuildRefs, type GuildRef } from '../shared/guild-refs.service.js';
import { CURRENT_RAID, type BossesQuery } from './dto/bosses-query.dto.js';
import type { BossEntry, BossRanking, BossRaid, BossesResponse } from './bosses.types.js';

/**
 * The first guilds to kill each boss of a raid, from Rankwarden's `bosses`,
 * with the raid from the catalogue and each guild from `guilds`.
 *
 * - The raid is the one named, or with `current` the raid in progress
 *   (`PveCatalogue.currentRaid`). Its bosses come in its own boss order.
 * - One difficulty for the whole answer: the one asked for, or without one the
 *   hardest on which any of the bosses has guilds — mythic, then heroic, then
 *   normal. Every boss is answered at it, so a boss nobody has killed there
 *   (a late one, early in a tier) has an empty board rather than an easier one.
 * - Two reads: the raid's bosses (`boss_raid_slug_name`), projected to the
 *   board of the region and the difficulties wanted; then every guild on the
 *   chosen boards through `GuildRefs`, in one read.
 *
 * Whole boards (up to 50 guilds) are cached in Redis per region, raid, boss and
 * difficulty for `BOSSES_CACHE_TTL_SECONDS`; `top` is applied to the cached
 * answer, so it does not multiply the keys.
 */
@Injectable()
export class BossesService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly catalogue: PveCatalogue,
    private readonly guildRefs: GuildRefs,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('BOSSES_CACHE_TTL_SECONDS', { infer: true });
  }

  async bosses(query: BossesQuery): Promise<BossesResponse> {
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

    const encounters = query.bossSlug
      ? raid.encounters.filter((encounter) => encounter.slug === query.bossSlug)
      : raid.encounters;
    if (encounters.length === 0) {
      throw new NotFoundException({
        message: query.bossSlug
          ? `No boss ${query.bossSlug} in ${raid.slug}`
          : `${raid.slug} lists no bosses`,
      });
    }

    const key = [
      'pve:bosses',
      query.region,
      raid.slug,
      query.bossSlug ?? '-',
      query.difficulty ?? '-',
    ].join(':');
    const cached = await this.cache.getOrLoad(
      key,
      () => this.load(raid, encounters, query.region, query.difficulty ?? null),
      this.cacheTtlSeconds,
    );

    return {
      region: query.region,
      difficulty: cached!.difficulty,
      bosses: cached!.bosses.map((boss) => ({
        ...boss,
        bossRankings: boss.bossRankings.slice(0, query.top),
      })),
    };
  }

  private async load(
    raid: CatalogueRaid,
    encounters: RaidEncounter[],
    region: string,
    difficulty: BossDifficulty | null,
  ): Promise<Pick<BossesResponse, 'difficulty' | 'bosses'>> {
    const difficulties = difficulty ? [difficulty] : BOSS_DIFFICULTIES;
    const docs = await this.mongo
      .collection<BossDocument>(Collections.Bosses)
      .find(
        { raidSlug: raid.slug, slug: { $in: encounters.map((encounter) => encounter.slug) } },
        {
          projection: {
            _id: 0,
            id: 1,
            slug: 1,
            name: 1,
            ...Object.fromEntries(difficulties.map((d) => [`bossRankings.${region}.${d}`, 1])),
          },
        },
      )
      .toArray();

    const byId = new Map(docs.map((doc) => [doc.id, doc]));
    const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

    const found = encounters.map((encounter) => {
      const doc = byId.get(encounter.id) ?? bySlug.get(encounter.slug);
      return { encounter, doc, boards: doc?.bossRankings?.[region] ?? {} };
    });

    // The difficulty asked for, or the hardest any boss has guilds on.
    const picked =
      difficulty ??
      difficulties.find((d) => found.some(({ boards }) => (boards[d]?.length ?? 0) > 0)) ??
      null;
    const chosen = found.map(({ encounter, doc, boards }) => ({
      encounter,
      doc,
      board: picked ? (boards[picked] ?? []) : [],
    }));

    const guildOf = await this.guildRefs.byIds(
      chosen.flatMap(({ board }) => board.map((row) => row.guildId)),
    );

    const raidRef: BossRaid = {
      slug: raid.slug,
      name: raid.name,
      icon: raid.icon,
      expansionId: raid.expansionId,
    };

    const bosses: BossEntry[] = chosen.map(({ encounter, doc, board }) => ({
      bossName: doc?.name ?? encounter.name,
      bossSlug: encounter.slug,
      raid: raidRef,
      bossRankings: [...board]
        .sort((a, b) => a.rank - b.rank)
        .map((row) => ranking(row, guildOf(row.guildId))),
    }));

    return { difficulty: picked, bosses };
  }
}

function ranking(row: BossRankedGuild, guild: GuildRef): BossRanking {
  return {
    rank: row.rank,
    itemLevelAvg: row.itemLevelAvg ?? null,
    attempts: row.attempts ?? null,
    firstDefeated: row.firstDefeated ? new Date(row.firstDefeated).toISOString() : null,
    guild,
  };
}
