import { Injectable, NotFoundException } from '@nestjs/common';
import type { Filter } from 'mongodb';

import type { Region } from '../../blizzard/blizzard.constants.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import type { SpecRepresentationDocument } from '../entities/spec-representation.entity.js';
import { regionsOf } from '../world.js';
import { combineSnapshots } from './combine.js';
import {
  HISTORY_DAYS,
  type RepresentationHistoryQuery,
} from './dto/representation-history-query.dto.js';
import { LATEST, type RepresentationQuery } from './dto/representation-query.dto.js';
import type {
  RepresentationDay,
  RepresentationHistoryResponse,
  RepresentationResponse,
} from './representation.types.js';

const day = (date: Date) => date.toISOString().slice(0, 10);

type Snapshot = Pick<
  SpecRepresentationDocument,
  'region' | 'date' | 'computedAt' | 'total' | 'classified' | 'specs'
>;

const SNAPSHOT_PROJECTION = {
  _id: 0,
  region: 1,
  date: 1,
  computedAt: 1,
  total: 1,
  classified: 1,
  specs: 1,
} as const;

/** One region as an equality, several as `$in`. */
const inRegions = (regions: Region[]) => (regions.length === 1 ? regions[0]! : { $in: regions });

/**
 * Per region and day, the snapshot of the newest season: a rollover day can
 * hold two. `docs` sorted `{ seasonId: -1 }` within a day, so the first wins.
 */
function newestPerRegion(docs: readonly Snapshot[]): Snapshot[] {
  const seen = new Set<string>();

  return docs.filter((doc) => {
    const key = `${day(new Date(doc.date))}|${doc.region}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Spec representation snapshots, read straight from MongoDB.
 *
 * Not cached: the collection is a few hundred small documents, and a request
 * reads one per region of one day, or of 31 days for the history.
 *
 * No season parameter: Rankwarden removes snapshots from before the current
 * season, so a day names one season. Should two ever share a day — a rollover
 * — the newer season's wins, per region.
 *
 * **`world`**: Rankwarden writes snapshots per region only, so a day's world
 * figures are its regions' snapshots added up (`combineSnapshots`): counts
 * summed, shares worked out again. Only the regions with a snapshot that day
 * are in it, and `regions` says which. `latest` is the newest day any region
 * has; `earliestDate` the first day any region has classified specs.
 *
 * A day without a snapshot is a 404, and so is `latest` with nothing stored.
 */
@Injectable()
export class RepresentationService {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.collection<SpecRepresentationDocument>(Collections.SpecRepresentation);
  }

  async snapshot(query: RepresentationQuery): Promise<RepresentationResponse> {
    const regions = regionsOf(query.region);
    const key: Filter<SpecRepresentationDocument> = {
      region: inRegions(regions),
      family: query.bracket,
      minRating: query.rating,
    };

    // Null for `latest`: the newest day stored, whether or not it has
    // classified specs — the front end is asking for "now", not the best day.
    const asked = query.date === LATEST ? null : query.date;

    const [date, earliest] = await Promise.all([
      asked
        ? Promise.resolve(asked)
        : this.collection
            .findOne(key, { projection: { _id: 0, date: 1 }, sort: { date: -1 } })
            .then((doc) => (doc ? new Date(doc.date) : null)),
      query.getEarliestDate
        ? this.collection.findOne(
            // "Filled" means at least one spec classified: before Rankwarden
            // has enriched a 2v2, 3v3 or RBG ladder its snapshots count
            // players but name no spec, and the calendar should not offer them.
            { ...key, classified: { $gt: 0 } },
            { projection: { _id: 0, date: 1 }, sort: { date: 1 } },
          )
        : Promise.resolve(null),
    ]);

    const snapshots = date
      ? newestPerRegion(
          await this.collection
            .find({ ...key, date }, { projection: SNAPSHOT_PROJECTION })
            .sort({ seasonId: -1 })
            .toArray(),
        )
      : [];

    if (snapshots.length === 0) {
      const where = `${query.region} ${query.bracket} at ${query.rating}`;
      throw new NotFoundException({
        message: asked
          ? `No spec representation snapshot for ${where} on ${day(asked)}`
          : `No spec representation snapshot stored for ${where}`,
      });
    }

    const combined = combineSnapshots(snapshots);
    const response: RepresentationResponse = {
      region: query.region,
      bracket: query.bracket,
      rating: query.rating,
      regions: snapshots.map((snapshot) => snapshot.region).sort(),
      date: day(new Date(date!)),
      computedAt: new Date(combined.computedAt).toISOString(),
      total: combined.total,
      classified: combined.classified,
      specs: [...(combined.specs ?? [])].sort((a, b) => b.count - a.count),
    };

    if (query.getEarliestDate) response.earliestDate = earliest ? day(earliest.date) : null;

    return response;
  }

  /**
   * The last `HISTORY_DAYS` UTC days, today included, oldest first, only the
   * days that have a snapshot. One range read through `snapshot_identity`
   * (date first): at most 31 documents a region, each spec exactly as the
   * day's own endpoint gives it, hero talents included — about 265 KB for a
   * full Solo Shuffle month of one region before compression. On `world`,
   * each day is that day's regions combined, as the day endpoint does.
   *
   * 404 only when the whole window is empty.
   */
  async history(
    query: RepresentationHistoryQuery,
    now = new Date(),
  ): Promise<RepresentationHistoryResponse> {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to.getTime() - (HISTORY_DAYS - 1) * DAY_MS);

    const docs = await this.collection
      .find(
        {
          region: inRegions(regionsOf(query.region)),
          family: query.bracket,
          minRating: query.rating,
          date: { $gte: from, $lte: to },
        },
        { projection: SNAPSHOT_PROJECTION, sort: { date: 1, seasonId: -1 } },
      )
      .toArray();

    const byDay = new Map<string, Snapshot[]>();
    for (const doc of newestPerRegion(docs)) {
      const date = day(new Date(doc.date));
      byDay.set(date, [...(byDay.get(date) ?? []), doc]);
    }

    const days: RepresentationDay[] = [...byDay].map(([date, snapshots]) => {
      const combined = combineSnapshots(snapshots);
      return {
        date,
        regions: snapshots.map((snapshot) => snapshot.region).sort(),
        computedAt: new Date(combined.computedAt).toISOString(),
        total: combined.total,
        classified: combined.classified,
        specs: [...(combined.specs ?? [])].sort((a, b) => b.count - a.count),
      };
    });

    if (days.length === 0) {
      throw new NotFoundException({
        message:
          `No spec representation snapshots for ${query.region} ${query.bracket} at ` +
          `${query.rating} between ${day(from)} and ${day(to)}`,
      });
    }

    return {
      region: query.region,
      bracket: query.bracket,
      rating: query.rating,
      from: day(from),
      to: day(to),
      days,
    };
  }
}

const DAY_MS = 86_400_000;
