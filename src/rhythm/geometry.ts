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
