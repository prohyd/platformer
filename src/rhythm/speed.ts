// Song time <-> world x when the speed changes along the level (speed portals).
import type { SpeedSeg } from './types.ts';

/** Index of the segment that is active at time t. */
function segAt(segs: SpeedSeg[], t: number) {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}

/** World x of the runner at song time t. */
export function xAt(segs: SpeedSeg[], t: number) {
  const s = segAt(segs, t);
  return s.x + (t - s.t) * s.speed;
}

/** Running speed at song time t, px/s. */
export function speedAt(segs: SpeedSeg[], t: number) {
  return segAt(segs, t).speed;
}

/** Song time when the runner is at world x. */
export function tAt(segs: SpeedSeg[], x: number) {
  let s = segs[0];
  for (const g of segs) if (g.x <= x) s = g;
  return s.t + (x - s.x) / s.speed;
}
