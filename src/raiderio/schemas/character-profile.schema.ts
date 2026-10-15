import { z } from 'zod';

/** One run in `mythic_plus_best_runs`. */
const bestRunSchema = z.object({
  dungeon: z.string(),
  short_name: z.string(),
  mythic_level: z.number().int(),
  completed_at: z.string(),
  clear_time_ms: z.number().int(),
  par_time_ms: z.number().int().nullable().optional(),
  num_keystone_upgrades: z.number().int().nullable().optional(),
  keystone_run_id: z.number().int(),
  zone_id: z.number().int().optional(),
  score: z.number(),
  url: z.string().optional(),
});

const seasonScoreSchema = z.object({
  season: z.string(),
  scores: z.object({ all: z.number() }).passthrough(),
});

/**
 * GET /characters/profile?region=&realm=&name=&fields=…
 *
 * The base profile, plus the `fields` Soulseeker asks for. Every field-backed
 * key is optional, so one schema serves however many fields a caller wants.
 */
export const raiderIoCharacterSchema = z.object({
  name: z.string(),
  race: z.string(),
  class: z.string(),
  active_spec_name: z.string().nullable().optional(),
  active_spec_role: z.string().nullable().optional(),
  faction: z.string().nullable().optional(),
  region: z.string(),
  realm: z.string(),
  profile_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  last_crawled_at: z.string().optional(),
  mythic_plus_scores_by_season: z.array(seasonScoreSchema).optional(),
  mythic_plus_best_runs: z.array(bestRunSchema).optional(),
});

export type RaiderIoCharacterPayload = z.infer<typeof raiderIoCharacterSchema>;
