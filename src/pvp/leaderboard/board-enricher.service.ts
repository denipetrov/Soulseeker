import { Injectable } from '@nestjs/common';

import type { RatingRow } from '../../characters/entities/character.entity.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';
import type { PvpSeason } from '../seasons/pvp-season.types.js';
import { currentEntry, type BoardCharacter } from './leaderboard.mapper.js';
import type { LeaderboardEntry } from './leaderboard.types.js';

/** What a ratings row has to carry to become an entry. */
export const ROW_PROJECTION = {
  _id: 0,
  characterId: 1,
  bracket: 1,
  rating: 1,
  class: 1,
  spec: 1,
} as const;

export type BoardRow = Pick<RatingRow, 'characterId' | 'bracket' | 'rating' | 'class' | 'spec'>;

/** What enrichment needs of a profile, and nothing else: talent codes are kilobytes. */
const PROFILE_PROJECTION = {
  'profile.class.name': 1,
  'profile.spec.name': 1,
  'profile.heroTalentTree.name': 1,
  'profile.talentLoadouts.spec.name': 1,
  'profile.talentLoadouts.heroTalentTree.name': 1,
  'profile.gender': 1,
  'profile.level': 1,
  'profile.race.name': 1,
} as const;

/**
 * Turns live ratings rows into leaderboard entries: one batch read of
 * `characters` for the whole set (names, records, profiles), then the mapper.
 *
 * Shared by every endpoint that lists live characters — the leaderboard and
 * the title-cutoff list — so an entry looks the same wherever it appears.
 */
@Injectable()
export class BoardEnricher {
  constructor(private readonly mongo: MongoService) {}

  async entries(rows: readonly BoardRow[], season: PvpSeason): Promise<LeaderboardEntry[]> {
    const characters = await this.charactersOf(rows, season);

    return rows.map((row) => currentEntry(row, characters.get(row.characterId), season));
  }

  /** The rows' characters, in one read, with only the ladders the rows are on. */
  private async charactersOf(
    rows: readonly Pick<RatingRow, 'characterId' | 'bracket'>[],
    season: PvpSeason,
  ): Promise<Map<number, BoardCharacter>> {
    if (rows.length === 0) return new Map();

    const projection: Record<string, 0 | 1> = {
      _id: 0,
      characterId: 1,
      characterName: 1,
      realmSlug: 1,
      faction: 1,
      profileStatus: 1,
      ...PROFILE_PROJECTION,
    };
    for (const bracket of new Set(rows.map((row) => row.bracket))) {
      projection[`brackets.${bracket}`] = 1;
    }

    const docs = await this.mongo
      .collection<BoardCharacter & { seasonId: number; region: string }>(Collections.Characters)
      .find(
        {
          seasonId: season.seasonId,
          region: season.region,
          characterId: { $in: rows.map((row) => row.characterId) },
        },
        { projection },
      )
      .toArray();

    return new Map(docs.map((doc) => [doc.characterId, doc as BoardCharacter]));
  }
}
