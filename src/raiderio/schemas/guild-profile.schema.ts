import { z } from 'zod';

/** A part of a payload kept as Raider.io shapes it. */
const asIs = z.unknown();

/** One member: the guild rank (0 = guild master) and the character's base profile. */
const memberSchema = z.object({
  rank: z.number().int(),
  character: z.looseObject({ name: z.string(), realm: z.string().optional() }),
});

/**
 * GET /guilds/profile?region=&realm=&name=&fields=…
 *
 * The base profile, plus the `fields` asked for; every field-backed key is
 * optional. `realm` is the realm's display name ("Tarren Mill"), not its slug.
 */
export const raiderIoGuildSchema = z.object({
  name: z.string(),
  displayName: z.string().nullable().optional(),
  faction: z.string().nullable().optional(),
  region: z.string(),
  realm: z.string(),
  last_crawled_at: z.string().optional(),
  profile_url: z.string().optional(),
  // `raid_progression:<…>`: per raid slug, `summary` ("9/9 M") and bosses killed per difficulty.
  raid_progression: z.record(z.string(), z.record(z.string(), asIs)).optional(),
  // `raid_rankings:<…>`: per raid slug, per difficulty, `{ world, region, realm }`.
  raid_rankings: z.record(z.string(), z.record(z.string(), asIs)).optional(),
  // `raid_encounters:<raid>:<difficulty>`: each boss killed, with when.
  raid_encounters: z
    .array(z.object({ slug: z.string(), name: z.string(), defeatedAt: z.string().nullable() }))
    .optional(),
  // `members`: up to ~1,000 entries for a large guild (~350 KB).
  members: z.array(memberSchema).optional(),
});

export type RaiderIoGuildPayload = z.infer<typeof raiderIoGuildSchema>;
export type RaiderIoGuildMember = z.infer<typeof memberSchema>;

/**
 * GET /guilds/boss-kill?region=&realm=&guild=&raid=&boss=&difficulty=
 *
 * The guild's first kill of one boss on one difficulty: the kill (times,
 * duration, the group's item level) and the roster, each player with talents,
 * items and auras — ~870 KB for a 20-player kill. Kept as it comes. `{}` when
 * the guild has not killed it.
 */
export const raiderIoBossKillSchema = z.object({
  kill: z.record(z.string(), asIs).nullable().optional(),
  roster: z.array(asIs).optional(),
});

export type RaiderIoBossKillPayload = z.infer<typeof raiderIoBossKillSchema>;
