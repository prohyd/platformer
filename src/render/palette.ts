// Colours. Each song gets its own neon palette from a hue.
import type { Grade, Rank } from '../rhythm/Scorer.ts';

export interface Palette {
  hue: number;
  skyTop: string;
  skyBot: string;
  /** Main neon: floor edges, gems. */
  neon: string;
  /** Second neon: spikes, trail, combo. */
  neon2: string;
  /** Jump markers, orbs, launch pads. */
  accent: string;
  ground: string;
  groundDeep: string;
}

export function palette(hue: number): Palette {
  return {
    hue,
    skyTop: `hsl(${hue + 230}, 55%, 7%)`,
    skyBot: `hsl(${hue + 290}, 60%, 20%)`,
    neon: `hsl(${hue}, 100%, 62%)`,
    neon2: `hsl(${hue + 300}, 100%, 66%)`,
    accent: `hsl(${hue + 50}, 100%, 65%)`,
    ground: `hsl(${hue + 240}, 45%, 13%)`,
    groundDeep: `hsl(${hue + 240}, 50%, 5%)`,
  };
}

export const GRADE_COLORS: Record<Grade, string> = { PERFECT: '#7df9ff', GREAT: '#7dff9a', GOOD: '#ffe27a', MISS: '#ff4d6d' };
export const RANK_COLORS: Record<Rank, string> = { S: '#ffe27a', A: '#7df9ff', B: '#7dff9a', C: '#ffb066', D: '#ff6b8b' };
export const DANGER = '#ff6b8b';
export const GOLD = '#ffe27a';
