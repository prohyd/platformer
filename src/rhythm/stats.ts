// How busy a level is, measured like in Geometry Dash: clicks per second (CPS).
import type { Chart } from './types.ts';

export interface ChartStats {
  /** Total presses the level asks for. */
  clicks: number;
  /** Clicks per second over the whole song. */
  avgCps: number;
  /** The busiest stretch: most clicks in any PEAK_WINDOW seconds, per second. */
  peakCps: number;
  /** How many patterns were placed. */
  patterns: number;
}

/** Window for the peak CPS, s. */
export const PEAK_WINDOW = 3;

export function chartStats(c: Chart): ChartStats {
  const ts = c.cues.map((q) => q.t).sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] > PEAK_WINDOW) j++;
    peak = Math.max(peak, i - j + 1);
  }
  return {
    clicks: ts.length,
    avgCps: ts.length / Math.max(1, c.duration),
    peakCps: peak / PEAK_WINDOW,
    patterns: c.patterns?.length ?? 0,
  };
}
