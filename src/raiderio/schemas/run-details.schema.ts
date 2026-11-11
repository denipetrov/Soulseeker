import { z } from 'zod';

const asIs = z.unknown();

/**
 * GET /mythic-plus/run-details?season=&id=
 *
 * One Mythic+ run. `season` is required and must be the run's own: with
 * another season Raider.io answers that season's run of the same id, not an
 * error. The whole answer is ~1.2 MB (logged details, videos, permissions);
 * only the fields the front end shows are kept, the roster as it comes — each
 * member with talents, items and ranks, ~45 KB a player.
 */
export const raiderIoRunDetailsSchema = z.object({
  season: z.string(),
  keystone_run_id: z.number(),
  dungeon: z.record(z.string(), asIs),
  mythic_level: z.number(),
  score: z.number().nullable().optional(),
  clear_time_ms: z.number().nullable().optional(),
  keystone_time_ms: z.number().nullable().optional(),
  time_remaining_ms: z.number().nullable().optional(),
  num_chests: z.number().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  faction: z.string().nullable().optional(),
  weekly_modifiers: z.array(asIs).optional(),
  roster: z.array(asIs).optional(),
});

export type RaiderIoRunDetailsPayload = z.infer<typeof raiderIoRunDetailsSchema>;
