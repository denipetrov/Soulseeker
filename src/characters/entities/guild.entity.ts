/**
 * A document in Rankwarden's `guilds`: one per guild that has appeared on a raid
 * ranking board, never removed. Read-only here.
 */
export interface GuildDocument {
  /** Raider.io's guild id. */
  id: number;
  name: string;
  /** `name` folded by spirit-link's `searchNameOf`; indexed as `guild_search`. */
  searchName: string;
  faction: string | null;
  logo: string | null;
  /** The guild's own region: `us`, `eu`, `kr`, `tw` or `cn`. */
  region: string;
  realm: { slug: string; name: string };
  updatedAt: Date;
}
