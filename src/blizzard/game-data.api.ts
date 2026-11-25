import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { isRegion, type NamespaceKind, type Region } from './blizzard.constants.js';
import { BlizzardHttpService } from './http/blizzard-http.service.js';
import {
  journalEncounterIndexSchema,
  journalInstanceIndexSchema,
  keystoneAffixIndexSchema,
  keystoneDungeonIndexSchema,
  playableClassIndexSchema,
  playableRaceIndexSchema,
  playableSpecializationIndexSchema,
  talentTreeIndexSchema,
  type NamedEntry,
} from './schemas/game-data-index.schema.js';

/** One Game Data index: path, namespace and the list it holds. */
interface IndexSpec {
  path: keyof Env;
  namespace: NamespaceKind;
  read: (payload: unknown) => NamedEntry[];
}

const INDEXES = {
  classes: {
    path: 'BLIZZARD_PATH_PLAYABLE_CLASSES',
    namespace: 'static',
    read: (payload) => playableClassIndexSchema.parse(payload).classes,
  },
  specializations: {
    path: 'BLIZZARD_PATH_PLAYABLE_SPECIALIZATIONS',
    namespace: 'static',
    read: (payload) => playableSpecializationIndexSchema.parse(payload).character_specializations,
  },
  races: {
    path: 'BLIZZARD_PATH_PLAYABLE_RACES',
    namespace: 'static',
    read: (payload) => playableRaceIndexSchema.parse(payload).races,
  },
  heroTalentTrees: {
    path: 'BLIZZARD_PATH_TALENT_TREES',
    namespace: 'static',
    read: (payload) => talentTreeIndexSchema.parse(payload).hero_talent_trees,
  },
  keystoneAffixes: {
    path: 'BLIZZARD_PATH_KEYSTONE_AFFIXES',
    namespace: 'static',
    read: (payload) => keystoneAffixIndexSchema.parse(payload).affixes,
  },
  // Dungeons are a season's, so they live in the dynamic namespace.
  keystoneDungeons: {
    path: 'BLIZZARD_PATH_KEYSTONE_DUNGEONS',
    namespace: 'dynamic',
    read: (payload) => keystoneDungeonIndexSchema.parse(payload).dungeons,
  },
  journalInstances: {
    path: 'BLIZZARD_PATH_JOURNAL_INSTANCES',
    namespace: 'static',
    read: (payload) => journalInstanceIndexSchema.parse(payload).instances,
  },
  journalEncounters: {
    path: 'BLIZZARD_PATH_JOURNAL_ENCOUNTERS',
    namespace: 'static',
    read: (payload) => journalEncounterIndexSchema.parse(payload).encounters,
  },
} as const satisfies Record<string, IndexSpec>;

export type GameDataIndex = keyof typeof INDEXES;
export const GAME_DATA_INDEXES = Object.keys(INDEXES) as GameDataIndex[];

/**
 * Blizzard's Game Data indexes, each asked with no locale so every name comes
 * in every language Blizzard has (`en_US`, `es_ES`, `pt_BR`, `fr_FR`, `de_DE`,
 * `ru_RU`, `ko_KR`, `zh_CN`, …) in one request. Read from the region the token
 * is asked for (`BLIZZARD_REGION`): these lists are the same in every region.
 */
@Injectable()
export class GameDataApi {
  private readonly region: Region;
  private readonly paths: Record<GameDataIndex, string>;

  constructor(
    private readonly http: BlizzardHttpService,
    config: ConfigService<Env, true>,
  ) {
    // `cn` issues tokens but has no Game Data on the global hosts: read the US one then.
    const region = config.get('BLIZZARD_REGION', { infer: true });
    this.region = isRegion(region) ? region : 'us';
    this.paths = Object.fromEntries(
      GAME_DATA_INDEXES.map((index) => [index, config.get(INDEXES[index].path, { infer: true })]),
    ) as Record<GameDataIndex, string>;
  }

  /** One index's entries, each `{ id, name: { <locale>: <name> } }`. */
  async index(index: GameDataIndex): Promise<NamedEntry[]> {
    const payload = await this.http.get(this.region, this.paths[index], {
      namespace: INDEXES[index].namespace,
      locale: null,
    });

    return INDEXES[index].read(payload);
  }
}
