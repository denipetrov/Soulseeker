import { Injectable } from '@nestjs/common';

import type { GuildDocument } from '../../characters/entities/guild.entity.js';
import { Collections } from '../../database/collections.js';
import { MongoService } from '../../database/mongo.service.js';

/**
 * A guild as a ranking shows it, from Rankwarden's `guilds`. Every field but
 * `id` is null for a guild Rankwarden has not stored, which should not happen:
 * it stores each guild it ranks.
 */
export interface GuildRef {
  id: number;
  name: string | null;
  faction: 'alliance' | 'horde' | null;
  logo: string | null;
  realm: string | null;
  realmSlug: string | null;
  /** The guild's own region: on a `world` board, what tells two realms of one name apart. */
  region: string | null;
}

const PROJECTION = { _id: 0, id: 1, name: 1, faction: 1, logo: 1, realm: 1, region: 1 } as const;

const factionOf = (faction: string | null | undefined): GuildRef['faction'] =>
  faction === 'alliance' || faction === 'horde' ? faction : null;

/**
 * The guilds behind a ranking board, by Raider.io guild id: one `$in` read on
 * `guilds` through `guild_identity`, however many boards ask. Used by the boss
 * and raid boards.
 */
@Injectable()
export class GuildRefs {
  constructor(private readonly mongo: MongoService) {}

  /** A function from guild id to its ref; an id not stored gives a ref of nulls. */
  async byIds(ids: Iterable<number>): Promise<(id: number) => GuildRef> {
    const unique = [...new Set(ids)];
    const docs = unique.length
      ? await this.mongo
          .collection<GuildDocument>(Collections.Guilds)
          .find({ id: { $in: unique } }, { projection: PROJECTION })
          .toArray()
      : [];
    const byId = new Map(docs.map((doc) => [doc.id, doc]));

    return (id) => {
      const guild = byId.get(id);

      return {
        id,
        name: guild?.name ?? null,
        faction: factionOf(guild?.faction),
        logo: guild?.logo ?? null,
        realm: guild?.realm?.name ?? null,
        realmSlug: guild?.realm?.slug ?? null,
        region: guild?.region ?? null,
      };
    };
  }
}
