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
  /** A difficulty name from the numbers above. */
  rating: string;
}

/** Window for the peak CPS, s. */
export const PEAK_WINDOW = 3;

/** Difficulty names by "effective CPS" (the average of mean and peak CPS). */
const RATINGS: [number, string][] = [
  [1.2, 'Легко'],
  [1.8, 'Нормально'],
  [2.4, 'Сложно'],
  [3.0, 'Очень сложно'],
  [3.6, 'Безумие'],
  [Infinity, 'Демон'],
];

export function chartStats(c: Chart): ChartStats {
  const ts = c.cues.map((q) => q.t).sort((a, b) => a - b);
  let peak = 0;
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] > PEAK_WINDOW) j++;
    peak = Math.max(peak, i - j + 1);
  }
  const avgCps = ts.length / Math.max(1, c.duration);
  const peakCps = peak / PEAK_WINDOW;
  // hardcore forgives less, so the same clicks are harder there
  const eff = (avgCps + peakCps) / 2 + (c.mode === 'hardcore' ? 0.4 : 0);
  return {
    clicks: ts.length,
    avgCps,
    peakCps,
    patterns: c.patterns?.length ?? 0,
    rating: RATINGS.find(([lim]) => eff < lim)![1],
  };
}

/** Clicks per second the level asks for around time t (over `window` seconds). */
export function cpsAround(c: Chart, t: number, window = 3) {
  let n = 0;
  for (const q of c.cues) {
    if (q.t < t - window / 2) continue;
    if (q.t > t + window / 2) break;
    n++;
  }
  return n / window;
}
