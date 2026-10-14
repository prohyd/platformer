// The conductor: walks through the beats of the song and asks the patterns
// what to put on each beat. Strong beats get obstacles, calm beats get gems,
// big moments get launch pads.
import type { Analysis } from '../../audio/analyze.ts';
import { CONFIG } from '../../config.ts';
import type { Chart, Difficulty, Mode } from '../types.ts';
import { ChartBuilder, type Beat } from './ChartBuilder.ts';
import { ACCENT_PATTERNS, JUMP_PATTERNS, QUIET_PATTERNS } from './patterns.ts';

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How strongly beat i "asks" for an action: onset, kick and loudness, off-beats a bit less. */
function beatStrength(an: Analysis, i: number) {
  return 0.45 * an.onset[i] + 0.35 * an.kick[i] + 0.3 * an.energy[i] - (i % 2 ? 0.06 : 0);
}

/** How many following beats are strong enough to continue an orb chain. */
function chainLength(b: ChartBuilder, i: number) {
  const { an, P, airBeats } = b;
  const n = an.beats.length;
  let chain = 0;
  if (P.chainMax > 0 && an.smooth[i] > P.chainMinEnergy) {
    for (let m = 1; m <= P.chainMax; m++) {
      const j = i + m * airBeats;
      if (j >= n - 2 * airBeats) break;
      const s = 0.5 * an.onset[j] + 0.35 * an.kick[j] + 0.3 * an.energy[j];
      if (s >= P.threshold * 0.9) chain++;
      else break;
    }
  }
  return chain;
}

/** Builds the level for a song. Same inputs always give the same level. */
export function buildChart(an: Analysis, diff: Difficulty, seed: number, mode: Mode = 'flow'): Chart {
  const P = CONFIG.levels[mode][diff];
  const b = new ChartBuilder(an, mode, P, seed + diff * 7919 + (mode === 'hardcore' ? 104729 : 0));
  const beats = an.beats;
  const n = beats.length;

  for (let i = 0; i < n - 3 * b.airBeats; i++) {
    if (beats[i] < b.nextT) continue;
    const beat: Beat = { i, t: beats[i], x: b.X(beats[i]), energy: an.smooth[i], strength: beatStrength(an, i) };

    // 1. Big moments in the music
    if (ACCENT_PATTERNS.some((p) => p.place(b, beat))) continue;

    // 2. Calm beats: no press needed
    if (beat.strength < P.threshold || i - b.lastAction < P.minGap * b.airBeats) {
      b.quietRun++;
      for (const p of QUIET_PATTERNS) if (p.place(b, beat)) break;
      continue;
    }

    // 3. A press on this beat: the first jump pattern that fits is used
    b.quietRun = 0;
    const chain = chainLength(b, i);
    const r = b.rand();
    b.addCue(beat.t, b.curY, 'jump');
    // the jump physically starts on the beat, or on landing if we are still in the air
    const ts = Math.max(beat.t, b.lastLand);
    const jump = { r, chain, ts, xs: b.X(ts) };
    let landT = ts + b.airT;
    for (const p of JUMP_PATTERNS) {
      const placed = p.place(b, beat, jump);
      if (placed !== null) {
        landT = placed;
        break;
      }
    }
    b.finishAction(beat, landT);
  }
  return b.build();
}
