import { z } from 'zod';

/** A part of a payload kept as Raider.io shapes it. */
const asIs = z.unknown();

/** An affix on a run; its name and description live in Rankwarden's `mplus_affixes`. */
const affixSchema = z.object({
  id: z.number().int(),
  icon_url: z.string().optional(),
  wowhead_url: z.string().optional(),
});

/**
 * One run in `mythic_plus_best_runs`. Holds what the page shows and what a
 * Rankwarden sync needs (`zone_id`, `keystone_run_id`, `short_name`,
 * `par_time_ms`, `spec.id`); the mapper decides which goes where.
 */
const bestRunSchema = z.object({
  dungeon: z.string(),
  short_name: z.string(),
  mythic_level: z.number().int(),
  completed_at: z.string(),
  clear_time_ms: z.number().int(),
  par_time_ms: z.number().int().nullable().optional(),
  num_keystone_upgrades: z.number().int().nullable().optional(),
  keystone_run_id: z.number().int(),
  map_challenge_mode_id: z.number().int().optional(),
  zone_id: z.number().int().optional(),
  zone_expansion_id: z.number().int().optional(),
  icon_url: z.string().optional(),
  background_image_url: z.string().optional(),
  score: z.number(),
  affixes: z.array(affixSchema).optional(),
  url: z.string().optional(),
  spec: z.object({ id: z.number().int() }).nullable().optional(),
  role: z.string().nullable().optional(),
});

const seasonScoreSchema = z.object({
  season: z.string(),
  scores: z.object({ all: z.number() }).passthrough(),
  // The same scores per role and spec, each with the colour Raider.io shows it in.
  segments: z.record(z.string(), z.object({ color: z.string() }).passthrough()).optional(),
});

/** One equipped item: what the page renders, nothing else. */
const gearItemSchema = z.object({
  item_id: z.number().int(),
  item_level: z.number().int(),
  name: z.string(),
  icon: z.string().optional(),
  // 0 poor … 4 epic, 5 legendary: the border colour.
  item_quality: z.number().int().optional(),
  // The tier set the piece belongs to (`"36"`); absent on other items.
  tier: z.string().optional(),
  bonuses: z.array(z.number().int()).optional(),
  enchants_detail: z.array(asIs).optional(),
  gems_detail: z.array(asIs).optional(),
});

/**
 * GET /characters/profile?region=&realm=&name=&fields=…
 *
 * The base profile, plus the `fields` Soulseeker asks for. Every field-backed
 * key is optional, so one schema serves however many fields a caller wants.
 * Note that `realm` is the realm's display name ("Demon Soul"), not its slug.
 */
export const raiderIoCharacterSchema = z.object({
  name: z.string(),
  race: z.string(),
  class: z.string(),
  active_spec_name: z.string().nullable().optional(),
  active_spec_role: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  faction: z.string().nullable().optional(),
  achievement_points: z.number().int().optional(),
  region: z.string(),
  realm: z.string(),
  profile_url: z.string().optional(),
  // Raider.io's banner art for the profile, e.g. `classbanner_shaman1`.
  profile_banner: z.string().nullable().optional(),
  thumbnail_url: z.string().optional(),
  last_crawled_at: z.string().optional(),
  // `guild`: its realm is the display name, like the character's.
  guild: z.object({ name: z.string(), realm: z.string().optional() }).nullable().optional(),
  // `gear`: items keyed by slot (`head`, `finger1`, `mainhand`, …).
  gear: z
    .object({
      item_level_equipped: z.number().optional(),
      items: z.record(z.string(), gearItemSchema).default({}),
    })
    .optional(),
  // `talents:categorized`: the whole loadout, kept as it comes (~35 KB).
  talentLoadout: z.record(z.string(), asIs).optional(),
  // `raid_progression:<slug>` or `:current-expansion`, keyed by raid slug.
  raid_progression: z.record(z.string(), z.record(z.string(), asIs)).optional(),
  // `raid_achievement_curve:<slug>`: empty when neither AOTC nor Cutting Edge was earned.
  raid_achievement_curve: z.array(z.record(z.string(), asIs)).optional(),
  mythic_plus_scores_by_season: z.array(seasonScoreSchema).optional(),
  mythic_plus_ranks: z.record(z.string(), asIs).optional(),
  mythic_plus_best_runs: z.array(bestRunSchema).optional(),
  // The last 10 runs, and the highest keys: of the season, of this week and of last week.
  mythic_plus_recent_runs: z.array(bestRunSchema).optional(),
  mythic_plus_highest_level_runs: z.array(bestRunSchema).optional(),
  mythic_plus_weekly_highest_level_runs: z.array(bestRunSchema).optional(),
  mythic_plus_previous_weekly_highest_level_runs: z.array(bestRunSchema).optional(),
});

export type RaiderIoCharacterPayload = z.infer<typeof raiderIoCharacterSchema>;
export type RaiderIoBestRun = z.infer<typeof bestRunSchema>;
