import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunLogger } from '@denipetrov/spirit-link/logging';
import { searchNameOf } from '@denipetrov/spirit-link/search';

import { isRegion } from '../blizzard/blizzard.constants.js';
import type { CharacterDocument } from '../characters/entities/character.entity.js';
import type { Env } from '../config/env.schema.js';
import { Collections, Indexes } from '../database/collections.js';
import { MongoService } from '../database/mongo.service.js';
import { CacheService } from '../redis/cache.service.js';
import { hiddenCharacterKey, parseHiddenCharacterKey, type HiddenCharacter } from './hidden-key.js';

const LIST_KEY = 'hidden:list';
const PVP_IDS_KEY = 'hidden:pvp-ids';

/**
 * Cached answers that hidden players are left out of in the query itself, so
 * paging and totals stay exact: dropped when the list changes. Everything
 * else checks the list as it answers, so it needs no purge.
 */
const FILTERED_IN_QUERY = ['pvp:board:', 'pve:mplus-board:', 'search:'];

/** Rankwarden's `hidden_entries` document. */
interface HiddenEntryDocument {
  kind: 'character' | 'guild';
  key: string;
}

/** The list as cached: plain arrays, so it survives JSON. */
interface HiddenListValue {
  characters: string[];
  guilds: number[];
}

/** A Blizzard character, which stays its id across seasons. */
export interface HiddenPvpCharacter {
  region: string;
  characterId: number;
}

/** The hidden players and guilds, to ask about. */
export class HiddenSet {
  readonly characters: ReadonlySet<string>;
  readonly guilds: ReadonlySet<number>;

  constructor(value: HiddenListValue) {
    this.characters = new Set(value.characters);
    this.guilds = new Set(value.guilds);
  }

  get empty(): boolean {
    return this.characters.size === 0 && this.guilds.size === 0;
  }

  isCharacterHidden(
    region: string | null | undefined,
    realmSlug: string | null | undefined,
    name: string | null | undefined,
  ): boolean {
    return Boolean(
      region &&
      realmSlug &&
      name &&
      this.characters.has(hiddenCharacterKey(region, realmSlug, name)),
    );
  }

  isGuildHidden(id: number | null | undefined): boolean {
    return id !== null && id !== undefined && this.guilds.has(id);
  }

  /** The hidden players' keys, those of `regions` only when given. */
  characterKeys(regions?: readonly string[]): string[] {
    return [...this.characters].filter(
      (key) => !regions || regions.includes(key.slice(0, key.indexOf('/'))),
    );
  }
}

/**
 * The players and guilds hidden through Rankwarden's `POST /hidden`
 * (`hidden_entries`), for every reader to leave out.
 *
 * The list is the source of truth, not the `hidden` flags Rankwarden copies
 * onto `characters`, `mplus_characters` and `guilds`: the `*_ratings` rows and
 * both archives carry no flag, and the list names a player before any document
 * of theirs exists. It is a few entries, cached in Redis for
 * `HIDDEN_LIST_TTL_SECONDS` and dropped at once when changed through
 * `POST /admin/hidden`; a change made straight on Rankwarden shows within the TTL.
 */
@Injectable()
export class HiddenList {
  private readonly logger = new RunLogger(HiddenList.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly mongo: MongoService,
    private readonly cache: CacheService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('HIDDEN_LIST_TTL_SECONDS', { infer: true });
  }

  async current(): Promise<HiddenSet> {
    const value = await this.cache.getOrLoad<HiddenListValue>(
      LIST_KEY,
      async () => {
        const entries = await this.mongo
          .collection<HiddenEntryDocument>(Collections.HiddenEntries)
          .find({}, { projection: { _id: 0, kind: 1, key: 1 } })
          .toArray();

        return {
          characters: entries.filter((e) => e.kind === 'character').map((e) => e.key),
          guilds: entries.filter((e) => e.kind === 'guild').map((e) => Number(e.key)),
        };
      },
      this.ttlSeconds,
    );

    return new HiddenSet(value ?? { characters: [], guilds: [] });
  }

  /**
   * The Blizzard character ids of the hidden players, every season's: the
   * `*_ratings` rows and the archive name a character by id only. Found through
   * `character_search` by folded name, then matched on the exact key, as
   * Rankwarden matches them (folding drops accents: `Bìbà` is not `Biba`).
   */
  async pvpCharacterIds(): Promise<HiddenPvpCharacter[]> {
    const hidden = await this.current();
    const players = hidden
      .characterKeys()
      .map(parseHiddenCharacterKey)
      .filter((player): player is HiddenCharacter => player !== null && isRegion(player.region));
    if (players.length === 0) return [];

    const ids = await this.cache.getOrLoad<HiddenPvpCharacter[]>(
      PVP_IDS_KEY,
      async () => {
        const docs = await this.mongo
          .collection<CharacterDocument>(Collections.Characters)
          .find(
            { searchName: { $in: [...new Set(players.map((p) => searchNameOf(p.name)))] } },
            {
              projection: { _id: 0, region: 1, characterId: 1, realmSlug: 1, characterName: 1 },
              hint: Indexes.CharacterSearch,
            },
          )
          .toArray();

        const unique = new Map<string, HiddenPvpCharacter>();
        for (const doc of docs) {
          if (
            !hidden.characters.has(hiddenCharacterKey(doc.region, doc.realmSlug, doc.characterName))
          )
            continue;
          unique.set(`${doc.region}:${doc.characterId}`, {
            region: doc.region,
            characterId: doc.characterId,
          });
        }

        return [...unique.values()];
      },
      this.ttlSeconds,
    );

    return ids ?? [];
  }

  /**
   * A MongoDB condition that leaves the hidden players' rows out of a PvP read
   * (`*_ratings`, `archive_entries`): `$nor` one `{ region, characterId $in }`
   * per region. Null when nobody in `regions` is hidden, so the query is untouched.
   */
  async pvpExclusion(regions: readonly string[]): Promise<Record<string, unknown> | null> {
    const byRegion = new Map<string, number[]>();
    for (const { region, characterId } of await this.pvpCharacterIds()) {
      if (!regions.includes(region)) continue;
      byRegion.set(region, [...(byRegion.get(region) ?? []), characterId]);
    }
    if (byRegion.size === 0) return null;

    return {
      $nor: [...byRegion].map(([region, ids]) => ({ region, characterId: { $in: ids } })),
    };
  }

  /** Drops the cached list and every cached answer filtered by it in the query. */
  async invalidate(): Promise<void> {
    await this.cache.delete(LIST_KEY);
    await this.cache.delete(PVP_IDS_KEY);
    const purged = await this.cache.deleteByPrefix(FILTERED_IN_QUERY);
    this.logger.log(`Hidden list changed: ${purged} cached answer(s) dropped`);
  }
}
