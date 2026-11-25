import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import type { Locale } from '../blizzard/blizzard.constants.js';
import { GAME_DATA_INDEXES, GameDataApi, type GameDataIndex } from '../blizzard/game-data.api.js';
import type { NamedEntry } from '../blizzard/schemas/game-data-index.schema.js';
import { BudgetSpentException } from '../common/quota/budget-spent.exception.js';
import { budgetErrorOf } from '../common/quota/request-budget.js';
import { describeError } from '../common/utils/errors.js';
import type { Env } from '../config/env.schema.js';
import { Collections } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import { CacheService } from '../redis/cache.service.js';
import { SharedFlight } from '../redis/shared-flight.service.js';
import { PveCatalogue } from '../seasons/pve-catalogue.service.js';
import { buildGameNames, namesIn, type CatalogueDungeon } from './game-names.builder.js';
import type { GameNamesDocument, GameNamesResponse } from './game-names.types.js';

/** One Redis value with every name in every language, shared by every replica. */
export const GAME_NAMES_CACHE_KEY = 'i18n:game-names';

/**
 * Translated names for the front end, which shows Raider.io's English-only
 * data in the visitor's language by looking these up by id or slug.
 *
 * Built from 8 Blizzard Game Data indexes, each asked once for every language,
 * plus Rankwarden's raid and dungeon catalogue. Fresh for
 * `I18N_NAMES_TTL_SECONDS` (a week: names change with patches) and kept
 * `I18N_NAMES_STALE_SECONDS` longer, served stale when Blizzard cannot be asked.
 * One rebuild across every replica at a time (`SharedFlight`).
 */
@Injectable()
export class GameNamesService {
  private readonly logger = new RunLogger(GameNamesService.name);
  private readonly ttlMs: number;
  private readonly keepSeconds: number;

  constructor(
    private readonly gameData: GameDataApi,
    private readonly catalogue: PveCatalogue,
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    private readonly flights: SharedFlight,
    config: ConfigService<Env, true>,
  ) {
    const ttlSeconds = config.get('I18N_NAMES_TTL_SECONDS', { infer: true });
    this.ttlMs = ttlSeconds * 1000;
    this.keepSeconds = ttlSeconds + config.get('I18N_NAMES_STALE_SECONDS', { infer: true });
  }

  async names(locale: Locale): Promise<GameNamesResponse> {
    return namesIn(await this.document(), locale);
  }

  private async document(): Promise<GameNamesDocument> {
    const cached = await this.cache.get<GameNamesDocument>(GAME_NAMES_CACHE_KEY);
    if (cached && Date.now() - Date.parse(cached.builtAt) < this.ttlMs) return cached;

    try {
      const { value } = await this.flights.run(
        GAME_NAMES_CACHE_KEY,
        async () => {
          const built = await this.build();
          await this.cache.set(GAME_NAMES_CACHE_KEY, built, this.keepSeconds);
          return built;
        },
        async () => {
          const stored = await this.cache.get<GameNamesDocument>(GAME_NAMES_CACHE_KEY);
          return stored && (!cached || stored.builtAt > cached.builtAt) ? stored : null;
        },
      );

      return value;
    } catch (error) {
      if (cached) {
        this.logger.warn(`Serving translated names stale: ${describeError(error)}`);
        return cached;
      }

      const spent = budgetErrorOf(error);
      if (spent) {
        this.logger.warn(`Translated names not built: ${spent.message}`);
        throw new BudgetSpentException('Blizzard', 'the translated names');
      }

      this.logger.warn(`Translated names not built: ${describeError(error)}`);
      throw new BadGatewayException('Blizzard could not be reached; retry later.');
    }
  }

  private async build(): Promise<GameNamesDocument> {
    const [lists, raids, dungeons] = await Promise.all([
      Promise.all(GAME_DATA_INDEXES.map((index) => this.gameData.index(index))),
      this.catalogue.raids(),
      this.mongo
        .collection<CatalogueDungeon>(Collections.MplusDungeons)
        .find({}, { projection: { _id: 0, slug: 1, name: 1, challengeModeId: 1 } })
        .toArray(),
    ]);
    const indexes = Object.fromEntries(
      GAME_DATA_INDEXES.map((index, i) => [index, lists[i]!]),
    ) as Record<GameDataIndex, NamedEntry[]>;

    const document = buildGameNames(indexes, { raids, dungeons }, new Date());

    const { unmatched } = document;
    if (unmatched.dungeons.length + unmatched.raids.length + unmatched.bosses.length > 0) {
      this.logger.warn(
        `Translated names: no Blizzard name for ${unmatched.dungeons.length} dungeon(s), ` +
          `${unmatched.raids.length} raid(s), ${unmatched.bosses.length} boss(es); ` +
          'the front end shows English there',
      );
      this.logger.debug(`Unmatched: ${JSON.stringify(unmatched)}`);
    }

    return document;
  }
}
