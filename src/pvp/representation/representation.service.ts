import { Injectable, NotFoundException } from '@nestjs/common';

import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import type { SpecRepresentationDocument } from '../entities/spec-representation.entity.js';
import { LATEST, type RepresentationQuery } from './dto/representation-query.dto.js';
import type { RepresentationResponse } from './representation.types.js';

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Spec representation snapshots, read straight from MongoDB.
 *
 * Not cached: the collection is a few hundred small documents, and each
 * request reads exactly one of them, or two with `getEarliestDate`. Redis
 * would add a round trip and a memory cost to save MongoDB almost nothing.
 *
 * No season parameter: Rankwarden removes snapshots from before the current
 * season, so a day names one season. Should two ever share a day — a rollover
 * — the newer season's wins.
 *
 * A day without a snapshot is a 404, and so is `latest` with nothing stored.
 * The front end's first load asks for `latest`, which has a snapshot as soon
 * as Rankwarden has written one, so it gets `earliestDate` along with it.
 */
@Injectable()
export class RepresentationService {
  constructor(private readonly mongo: MongoService) {}

  async snapshot(query: RepresentationQuery): Promise<RepresentationResponse> {
    const collection = this.mongo.collection<SpecRepresentationDocument>(
      Collections.SpecRepresentation,
    );
    const key = { region: query.region, family: query.bracket, minRating: query.rating };

    // Null for `latest`: the newest day stored, whether or not it has
    // classified specs — the front end is asking for "now", not the best day.
    const asked = query.date === LATEST ? null : query.date;

    const [snapshot, earliest] = await Promise.all([
      asked
        ? collection.findOne(
            { ...key, date: asked },
            { projection: { _id: 0 }, sort: { seasonId: -1 } },
          )
        : collection.findOne(key, { projection: { _id: 0 }, sort: { date: -1, seasonId: -1 } }),
      query.getEarliestDate
        ? collection.findOne(
            // "Filled" means at least one spec classified: before Rankwarden
            // has enriched a 2v2, 3v3 or RBG ladder its snapshots count
            // players but name no spec, and the calendar should not offer them.
            { ...key, classified: { $gt: 0 } },
            { projection: { _id: 0, date: 1 }, sort: { date: 1 } },
          )
        : Promise.resolve(null),
    ]);

    if (!snapshot) {
      const where = `${query.region} ${query.bracket} at ${query.rating}`;
      throw new NotFoundException({
        message: asked
          ? `No spec representation snapshot for ${where} on ${day(asked)}`
          : `No spec representation snapshot stored for ${where}`,
      });
    }

    const response: RepresentationResponse = {
      region: query.region,
      bracket: query.bracket,
      rating: query.rating,
      date: day(new Date(snapshot.date)),
      computedAt: new Date(snapshot.computedAt).toISOString(),
      total: snapshot.total,
      classified: snapshot.classified,
      specs: [...(snapshot.specs ?? [])].sort((a, b) => b.count - a.count),
    };

    if (query.getEarliestDate) response.earliestDate = earliest ? day(earliest.date) : null;

    return response;
  }
}
