import { Injectable } from '@nestjs/common';

import { DEFAULT_LOCALE, type Locale, type Region } from '../../blizzard/blizzard.constants.js';
import { ProfileApi } from '../../blizzard/profile.api.js';
import { bracketOfHref } from '../../blizzard/schemas/pvp-summary.schema.js';
import { PvpSeasonsService } from '../seasons/pvp-seasons.service.js';
import type { PvpSeason } from '../seasons/pvp-season.types.js';
import { corePartOf, localizedPartOf } from './character.mapper.js';
import type { CorePart, LocalizedPart } from './character.types.js';
import { pvpHistoryOf } from './pvp-history.js';

export interface CharacterRef {
  region: Region;
  realmSlug: string;
  characterName: string;
}

/**
 * The Blizzard calls behind one PvP character page, split by what depends on
 * the language.
 *
 * Every call of a part runs at once. Any failure but a 404 fails the whole
 * part, so a page is never cached with a hole a retry would have filled.
 */
@Injectable()
export class CharacterLoader {
  constructor(
    private readonly profiles: ProfileApi,
    private readonly seasons: PvpSeasonsService,
  ) {}

  /**
   * Ratings, stats, render URLs and the PvP history: 4 requests, plus one per
   * ladder the character played this season. Read in English, which the
   * history's name patterns need and nothing here shows translated.
   */
  async core({ region, realmSlug, characterName }: CharacterRef): Promise<CorePart> {
    const startedAt = new Date();
    const at = [region, realmSlug, characterName, DEFAULT_LOCALE] as const;

    const [media, summary, statistics, achievements, seasons] = await Promise.all([
      this.profiles.getMedia(...at),
      this.profiles.getPvpSummary(...at),
      this.profiles.getStatistics(...at),
      this.profiles.getAchievements(...at),
      this.seasonsOf(region),
    ]);

    const ladders = (summary?.brackets ?? []).flatMap(({ href }) => {
      const bracket = bracketOfHref(href);
      return bracket ? [bracket] : [];
    });

    const brackets = await Promise.all(
      [...new Set(ladders)].map(async (bracket) => ({
        bracket,
        payload: await this.profiles.getPvpBracket(
          region,
          realmSlug,
          characterName,
          bracket,
          DEFAULT_LOCALE,
        ),
      })),
    );

    return corePartOf(
      {
        media,
        summary,
        brackets: brackets.flatMap(({ bracket, payload }) =>
          payload ? [{ bracket, payload }] : [],
        ),
        statistics,
        pvpHistory: achievements ? pvpHistoryOf(achievements, seasons) : [],
      },
      startedAt,
    );
  }

  /**
   * Profile, talents and equipment in one language: 3 requests. Null when
   * Blizzard has no such character.
   */
  async localized(
    { region, realmSlug, characterName }: CharacterRef,
    locale: Locale,
  ): Promise<LocalizedPart | null> {
    const startedAt = new Date();
    const at = [region, realmSlug, characterName, locale] as const;

    const [profile, specializations, equipment] = await Promise.all([
      this.profiles.getProfile(...at),
      this.profiles.getSpecializations(...at),
      this.profiles.getEquipment(...at),
    ]);

    if (!profile) return null;

    return localizedPartOf({ profile, specializations, equipment }, locale, startedAt);
  }

  /** Every season Rankwarden knows in the region, with its titles' achievement ids. */
  private async seasonsOf(region: Region): Promise<PvpSeason[]> {
    const summaries = await this.seasons.seasons(region);
    const seasons = await Promise.all(
      summaries.map((summary) => this.seasons.season(region, summary.seasonId)),
    );

    return seasons.filter((season): season is PvpSeason => season !== null);
  }
}
