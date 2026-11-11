import { z } from 'zod';

import { REGIONS, type Region } from '../blizzard/blizzard.constants.js';

/** Every region together: what the PvE endpoints call `world`, for PvP too. */
export const WORLD = 'world';

/** What a PvP endpoint reads: one region, or `world`. */
export const PVP_BOARDS = [WORLD, ...REGIONS] as const;
export type PvpBoard = (typeof PVP_BOARDS)[number];

/** The regions a board covers: every region on `world`, otherwise the one. */
export const regionsOf = (board: PvpBoard): Region[] => (board === WORLD ? [...REGIONS] : [board]);

/** The `region` query parameter of the PvP endpoints: a region, or `world`. */
export const pvpBoardSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(PVP_BOARDS))
  .meta({
    description: 'Blizzard region, or `world`: every region together.',
    enum: [...PVP_BOARDS],
    example: 'eu',
  });
