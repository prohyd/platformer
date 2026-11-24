// Sizes of the runner and the obstacles (from config), used by physics and rendering.
import { CONFIG } from '../config.ts';

export const PW = CONFIG.player.width;
export const PH = CONFIG.player.height;
export const HALF = PW / 2;
export const STEP = CONFIG.world.stepHeight;
export const SPIKE_H = CONFIG.world.spikeHeight;
/** Height of the gap under a ceiling trap: you fit while running, not while jumping. */
export const CEIL_GAP = CONFIG.world.ceilingGap;
export const CEIL_H = CONFIG.world.ceilingHeight;
/** Ceiling traps hang from a solid slab; this is how far the slab reaches below its top. */
export const CEIL_BAR = 14;

/** One tooth of a spike row is about this wide. */
export const TOOTH = 13;

/**
 * How many teeth a spike row of width `w` has and how wide one tooth is.
 * Shared by the renderer and the hitboxes so they always describe the same shape.
 */
export function teeth(w: number, min: number) {
  const n = Math.max(min, Math.round(w / TOOTH));
  return { n, sw: w / n };
}
