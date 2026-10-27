// The shape of a song: where bars start and where the music changes (intro, verse, chorus, break…).
// Works on per-beat features only, so it is cheap and easy to test.

/** A part of the song that sounds the same throughout. */
export interface Section {
  /** First beat (always a bar start). */
  start: number;
  /** Beat after the last one. */
  end: number;
  /** Loudness 0..1 (relative to the song). */
  energy: number;
  /** How "hot" the part is compared to the rest of the song, 0..1: loudness, attacks, busy off-beats. */
  intensity: number;
  /** How much happens between the beats, 0..1. */
  busy: number;
  /** Parts that sound alike share a label (a chorus that comes back gets the same one). */
  label: number;
}

export interface BeatFeatures {
  onset: number[];
  kick: number[];
  offbeat: number[];
  energy: number[];
  low: number[];
  mid: number[];
  high: number[];
}

const BEATS_PER_BAR = 4;

/** Which beat (0..3) starts the bars: the one where kicks and attacks are strongest. */
export function findBarPhase(f: BeatFeatures): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let p = 0; p < BEATS_PER_BAR; p++) {
    let s = 0;
    let n = 0;
    for (let i = p; i < f.kick.length; i += BEATS_PER_BAR) {
      s += f.kick[i] + 0.5 * f.onset[i] + 0.3 * f.low[i];
      n++;
    }
    s /= n || 1;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

/** Splits the song into sections at bar boundaries where the sound changes the most. */
export function findSections(f: BeatFeatures, phase: number): Section[] {
  const n = f.energy.length;
  // ---- one feature vector per bar
  const barStarts: number[] = [];
  if (phase > 0) barStarts.push(0);
  for (let i = phase; i < n; i += BEATS_PER_BAR) barStarts.push(i);
  barStarts.push(n);
  const bars: number[][] = [];
  for (let b = 0; b + 1 < barStarts.length; b++) {
    const s = barStarts[b];
    const e = barStarts[b + 1];
    const avg = (arr: number[]) => mean(arr.slice(s, e));
    bars.push([avg(f.energy) * 2, avg(f.low), avg(f.mid), avg(f.high), avg(f.onset), avg(f.offbeat)]);
  }
  const B = bars.length;
  if (B < 6) return [makeSection(f, 0, n, 0)];

  // z-score every dimension so that no single feature dominates
  const dims = bars[0].length;
  for (let d = 0; d < dims; d++) {
    const col = bars.map((v) => v[d]);
    const m = mean(col);
    const sd = Math.sqrt(mean(col.map((v) => (v - m) ** 2))) || 1;
    for (const v of bars) v[d] = (v[d] - m) / sd;
  }
  const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, d) => s + (v - b[d]) ** 2, 0) / dims);
  const avgVec = (from: number, to: number) => {
    const out = new Array(dims).fill(0);
    for (let b = from; b < to; b++) for (let d = 0; d < dims; d++) out[d] += bars[b][d] / (to - from);
    return out;
  };

  // ---- novelty: how different the 4 bars after a boundary are from the 4 bars before it
  const W = 4;
  const nov = new Array(B).fill(0);
  for (let b = 2; b < B - 1; b++) {
    const w = Math.min(W, b, B - b);
    nov[b] = dist(avgVec(b - w, b), avgVec(b, b + w));
  }
  const nm = mean(nov);
  const nsd = Math.sqrt(mean(nov.map((v) => (v - nm) ** 2))) || 1;
  // phrases in pop music are usually 4 or 8 bars long, counted from the first real bar
  const first = phase > 0 ? 1 : 0;
  const cands: { b: number; s: number }[] = [];
  for (let b = 2; b < B - 1; b++) {
    if (nov[b] < nov[b - 1] || nov[b] < nov[b + 1]) continue;
    const z = (nov[b] - nm) / nsd;
    const grid = (b - first) % 8 === 0 ? 0.5 : (b - first) % 4 === 0 ? 0.25 : 0;
    if (z + grid > 0.35) cands.push({ b, s: z + grid });
  }
  // strongest boundaries first, never closer than 4 bars
  cands.sort((x, y) => y.s - x.s);
  const cuts: number[] = [];
  for (const c of cands) if (cuts.every((k) => Math.abs(k - c.b) >= 4) && c.b >= 4 && B - c.b >= 4) cuts.push(c.b);
  // very long parts still change every 16 bars, so the level never gets stale
  cuts.sort((x, y) => x - y);
  const all = [0, ...cuts, B];
  const fixed: number[] = [0];
  for (let k = 1; k < all.length; k++) {
    const from = all[k - 1];
    const to = all[k];
    for (let b = from + 16; b <= to - 8; b += 16) fixed.push(b);
    fixed.push(to);
  }

  const sections: Section[] = [];
  for (let k = 0; k + 1 < fixed.length; k++) sections.push(makeSection(f, barStarts[fixed[k]], barStarts[fixed[k + 1]], 0));

  // ---- intensity relative to the song, labels for parts that sound alike
  const raw = sections.map((s) => s.energy * 0.6 + sliceMean(f.onset, s) * 0.25 + s.busy * 0.15);
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const vecs = sections.map((s) => avgVec(barIndex(barStarts, s.start), Math.max(barIndex(barStarts, s.start) + 1, barIndex(barStarts, s.end))));
  let labels = 0;
  sections.forEach((s, k) => {
    // half absolute loudness, half relative: a quiet song stays calm, but still has its peaks
    s.intensity = 0.5 * (hi > lo ? (raw[k] - lo) / (hi - lo) : 0.5) + 0.5 * Math.min(1, raw[k] / 0.75);
    s.label = -1;
    for (let j = 0; j < k; j++) {
      if (dist(vecs[j], vecs[k]) < 0.55) {
        s.label = sections[j].label;
        break;
      }
    }
    if (s.label < 0) s.label = labels++;
  });
  return sections;
}

function barIndex(barStarts: number[], beat: number) {
  const i = barStarts.indexOf(beat);
  return i < 0 ? barStarts.length - 1 : i;
}

function sliceMean(arr: number[], s: { start: number; end: number }) {
  return mean(arr.slice(s.start, s.end));
}

function makeSection(f: BeatFeatures, start: number, end: number, label: number): Section {
  const s = { start, end };
  return {
    start,
    end,
    energy: sliceMean(f.energy, s),
    intensity: 0.5,
    busy: sliceMean(f.offbeat, s),
    label,
  };
}
