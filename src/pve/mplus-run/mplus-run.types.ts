/**
 * One Mythic+ run from Raider.io, in its own field names, as the guild boss
 * kill is. Only what the run page shows is kept of Raider.io's ~1.2 MB answer.
 */
export interface MplusRunResponse {
  season: string;
  keystone_run_id: number;
  /** As Raider.io gives it: id, name, short name, slug, icon, timer, bosses… */
  dungeon: Record<string, unknown>;
  mythic_level: number;
  score: number | null;
  clear_time_ms: number | null;
  keystone_time_ms: number | null;
  time_remaining_ms: number | null;
  num_chests: number | null;
  /** ISO 8601. */
  completed_at: string | null;
  faction: string | null;
  /** The week's affixes in full: id, name, slug, description, icon. */
  weekly_modifiers: unknown[];
  /**
   * The five players as Raider.io gives them: character (class, spec, race,
   * realm, talents), guild, role, items, ranks. ~45 KB a player.
   */
  roster: unknown[];
}
