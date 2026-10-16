import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { escapeRegex } from '@denipetrov/spirit-link/search';

import type { CharacterDocument } from '../characters/entities/character.entity.js';
import type { GuildDocument } from '../characters/entities/guild.entity.js';
import type { MplusCharacterDocument } from '../characters/entities/mplus-character.entity.js';
import type { Env } from '../config/env.schema.js';
import { Collections, Indexes } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import { CacheService } from '../redis/cache.service.js';
import { CurrentSeasons } from '../seasons/current-seasons.service.js';
import { SearchType, type SuggestionsQuery } from './dto/suggestions-query.dto.js';
import {
  GUILD_PROJECTION,
  guildSuggestion,
  MPLUS_CHARACTER_PROJECTION,
  mplusCharacterSuggestion,
  PVP_CHARACTER_PROJECTION,
  pvpCharacterSuggestion,
} from './search.mapper.js';
import type { CharacterSuggestion, GuildSuggestion, SuggestionsResponse } from './search.types.js';

/** Most suggestions returned per list. */
export const SUGGESTION_LIMIT = 100;

/**
 * Name suggestions as the visitor types.
 *
 * Every query is a prefix match on `searchName`, the name Rankwarden stores
 * folded by spirit-link's `searchNameOf`; the query is folded by the same
 * function before it gets here. The pattern is anchored (`^`) and has no `i`
 * flag, which is what lets MongoDB answer it as a range on the index rather
 * than a scan. The index is named in a `hint`, because the season filter
 * alongside it would otherwise tempt the planner onto the season indexes,
 * which do not order by name.
 *
 * Results come in `searchName` order, so an exact match comes first and
 * longer names follow. Answers are cached in Redis per type and prefix: the
 * same few letters are typed by many visitors.
 */
@Injectable()
export class SearchService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly seasons: CurrentSeasons,
    config: ConfigService<Env, true>,
  ) {
    this.cacheTtlSeconds = config.get('SEARCH_CACHE_TTL_SECONDS', { infer: true });
  }

  async suggestions({ type, q }: SuggestionsQuery): Promise<SuggestionsResponse> {
    const result = await this.cache.getOrLoad(
      `search:${type}:${q}`,
      () => this.load(type, q),
      this.cacheTtlSeconds,
    );

    // Never null: `load` always answers, if only with empty lists.
    return result!;
  }

  private async load(type: SearchType, query: string): Promise<SuggestionsResponse> {
    const prefix = { $regex: `^${escapeRegex(query)}` };

    if (type === SearchType.PvP) {
      return { type, query, characters: await this.pvpCharacters(prefix), guilds: [] };
    }

    const [characters, guilds] = await Promise.all([
      this.mplusCharacters(prefix),
      this.guilds(prefix),
    ]);

    return { type, query, characters, guilds };
  }

  private async pvpCharacters(prefix: { $regex: string }): Promise<CharacterSuggestion[]> {
    const seasons = await this.seasons.pvpSeasons();
    if (seasons.length === 0) return [];

    const docs = await this.mongo
      .collection<CharacterDocument>(Collections.Characters)
      .find(
        {
          searchName: prefix,
          $or: seasons.map(({ region, seasonId }) => ({ region, seasonId })),
        },
        { projection: PVP_CHARACTER_PROJECTION },
      )
      .hint(Indexes.CharacterSearch)
      .limit(SUGGESTION_LIMIT)
      .toArray();

    return docs.map(pvpCharacterSuggestion);
  }

  private async mplusCharacters(prefix: { $regex: string }): Promise<CharacterSuggestion[]> {
    const seasons = await this.seasons.mplusSeasons();
    if (seasons.length === 0) return [];

    const docs = await this.mongo
      .collection<MplusCharacterDocument>(Collections.MplusCharacters)
      .find(
        {
          searchName: prefix,
          $or: seasons.map(({ region, season }) => ({ region, season })),
        },
        { projection: MPLUS_CHARACTER_PROJECTION },
      )
      .hint(Indexes.MplusCharacterSearch)
      .limit(SUGGESTION_LIMIT)
      .toArray();

    return docs.map(mplusCharacterSuggestion);
  }

  private async guilds(prefix: { $regex: string }): Promise<GuildSuggestion[]> {
    const docs = await this.mongo
      .collection<GuildDocument>(Collections.Guilds)
      .find({ searchName: prefix }, { projection: GUILD_PROJECTION })
      .hint(Indexes.GuildSearch)
      .limit(SUGGESTION_LIMIT)
      .toArray();

    return docs.map(guildSuggestion);
  }
}
