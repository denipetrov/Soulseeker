import { Injectable, NotFoundException } from '@nestjs/common';

import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import { classSlugOf, specSlugOf } from '../../pvp/specs.js';
import { PveCatalogue } from '../../seasons/pve-catalogue.service.js';
import { WORLD } from '../bosses/dto/bosses-query.dto.js';
import type { MplusSpecRepresentationDocument } from '../entities/mplus-spec-representation.entity.js';
import { MplusSeasonsService } from '../mplus-seasons/mplus-seasons.service.js';
import { MplusSeasonResolver } from '../shared/mplus-season.resolver.js';
import { ALL_DUNGEONS, type PveRepresentationQuery } from './dto/pve-representation-query.dto.js';
import type { PveRepresentationResponse } from './pve-representation.types.js';

/** Rankwarden's name for every region together. */
const ALL_REGIONS = 'all';

/**
 * Which specs a Mythic+ season's best runs were played with, from Rankwarden's
 * `mplus_spec_representation`, read straight from MongoDB.
 *
 * - `world` is Rankwarden's `region: 'all'`; `dungeonSlug=all` its
 *   `dungeonId: null`. A dungeon slug is checked against the season's
 *   dungeons, a 404 when it does not run there.
 * - `season` resolves as on the other Mythic+ endpoints (`MplusSeasonResolver`).
 * - One read by `mplus_representation_key` (season, region, dungeonId). Not
 *   cached, as the PvP snapshot is not: one small document per request.
 * - A missing snapshot is a 404 — a region or dungeon Rankwarden has not
 *   counted yet.
 */
@Injectable()
export class PveRepresentationService {
  constructor(
    private readonly mongo: MongoService,
    private readonly seasons: MplusSeasonResolver,
    private readonly seasonList: MplusSeasonsService,
    private readonly catalogue: PveCatalogue,
  ) {}

  async representation(query: PveRepresentationQuery): Promise<PveRepresentationResponse> {
    const { slug: season } = await this.seasons.resolve(query.region, query.season);
    const dungeonId =
      query.dungeonSlug === ALL_DUNGEONS
        ? null
        : (await this.seasonList.dungeon(season, query.dungeonSlug)).id;
    const region = query.region === WORLD ? ALL_REGIONS : query.region;

    const collection = this.mongo.collection<MplusSpecRepresentationDocument>(
      Collections.MplusSpecRepresentation,
    );
    const [doc, seasons] = await Promise.all([
      collection.findOne({ season, region, dungeonId }, { projection: { _id: 0 } }),
      query.getSeasons ? this.seasonsWithSnapshots(region, dungeonId) : Promise.resolve(null),
    ]);

    if (!doc) {
      throw new NotFoundException({
        message: `No spec representation for ${query.region}, ${query.dungeonSlug}, in ${season}`,
      });
    }

    const response: PveRepresentationResponse = {
      region: query.region,
      season,
      dungeon: query.dungeonSlug,
      source: doc.source,
      computedAt: new Date(doc.computedAt).toISOString(),
      runs: doc.runs,
      slots: doc.slots,
      classified: doc.classified,
      roles: doc.roles ?? {},
      specs: [...(doc.specs ?? [])]
        .sort((a, b) => b.count - a.count)
        .map((share) => ({
          class: classSlugOf(share.classId),
          spec: specSlugOf(share.specId),
          ...share,
        })),
    };
    if (seasons) response.seasons = seasons;

    return response;
  }

  /**
   * The seasons with a snapshot for a region and dungeon, newest first, by the
   * catalogue's order. A dungeon is matched by id, which recurs across seasons.
   */
  private async seasonsWithSnapshots(region: string, dungeonId: number | null): Promise<string[]> {
    const [stored, catalogue] = await Promise.all([
      this.mongo
        .collection<MplusSpecRepresentationDocument>(Collections.MplusSpecRepresentation)
        .distinct('season', { region, dungeonId }),
      this.catalogue.mplusSeasons(),
    ]);
    const have = new Set(stored);

    return catalogue.map((season) => season.slug).filter((slug) => have.has(slug));
  }
}
