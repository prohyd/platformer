// Timing judgements, score, combo, accuracy and rank.
import { CONFIG } from '../config.ts';
import type { Cue } from './types.ts';

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

const J = CONFIG.judge;
const S = CONFIG.score;
const POINTS: Record<Grade, number> = { PERFECT: S.PERFECT, GREAT: S.GREAT, GOOD: S.GOOD, MISS: 0 };

export class Scorer {
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Record<Grade, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  notesTaken = 0;
  private readonly cues: Cue[];
  /** Cues before this index are already decided. */
  private cueI = 0;

  constructor(cues: Cue[]) {
    this.cues = cues;
  }

  /** A press at `time` of the given kind: finds the nearest expected press and grades it. */
  judge(time: number, kind: Cue['kind']): { cue: Cue; grade: Grade } | null {
    let best: Cue | null = null;
    let bd = J.window;
    for (let i = this.cueI; i < this.cues.length; i++) {
      const cu = this.cues[i];
      if (cu.t - time > J.window) break;
      if (cu.judged || cu.kind !== kind) continue;
      const d = Math.abs(cu.t - time);
      if (d <= bd) {
        bd = d;
        best = cu;
      }
    }
    if (!best) return null;
    best.judged = true;
    const grade: Grade = bd <= J.perfect ? 'PERFECT' : bd <= J.great ? 'GREAT' : 'GOOD';
    this.counts[grade]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(POINTS[grade] * (1 + Math.min(this.combo, S.comboCap) / S.comboDivisor));
    return { cue: best, grade };
  }

  /** Cues that are long gone were survived without a press: they cost nothing. */
  expire(now: number) {
    while (this.cueI < this.cues.length && this.cues[this.cueI].t < now - J.window) {
      this.cues[this.cueI].judged = true;
      this.cueI++;
    }
  }

  /** A mistake: combo breaks and the cue we failed is used up. */
  miss(now: number) {
    this.counts.MISS++;
    this.combo = 0;
    for (let i = this.cueI; i < this.cues.length; i++) {
      const cu = this.cues[i];
      if (cu.t > now + 0.5) break;
      if (!cu.judged && cu.t > now - 0.6) {
        cu.judged = true;
        break;
      }
    }
  }

  gem() {
    this.notesTaken++;
    this.score += S.gem;
  }

  get accuracy() {
    const total = this.cues.length || 1;
    return (this.counts.PERFECT + this.counts.GREAT * CONFIG.accuracy.GREAT + this.counts.GOOD * CONFIG.accuracy.GOOD) / total;
  }

  get rank(): Rank {
    const a = this.accuracy;
    const R = CONFIG.ranks;
    if (a >= R.S && this.counts.MISS === 0) return 'S';
    if (a >= R.A) return 'A';
    if (a >= R.B) return 'B';
    if (a >= R.C) return 'C';
    return 'D';
  }
}
