// Timing judgements, score, combo, accuracy and rank.
import { CONFIG } from '../config.ts';
import type { Cue } from './types.ts';

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

/** Score at some moment of the run, to go back to after a death at a checkpoint. */
export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  notesTaken: number;
  decided: number;
}

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
  /** How many cues are already behind us (pressed, missed or skipped). */
  private decided = 0;

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
    this.decided++;
    const grade: Grade = bd <= J.perfect ? 'PERFECT' : bd <= J.great ? 'GREAT' : 'GOOD';
    this.counts[grade]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(POINTS[grade] * (1 + Math.min(this.combo, S.comboCap) / S.comboDivisor));
    return { cue: best, grade };
  }

  /** Start in the middle of the song (checkpoint): earlier cues are not counted again. */
  skipBefore(t: number) {
    while (this.cueI < this.cues.length && this.cues[this.cueI].t < t - 0.01) this.cues[this.cueI++].judged = true;
  }

  /** Cues that are long gone were survived without a press: they cost nothing. */
  expire(now: number) {
    while (this.cueI < this.cues.length && this.cues[this.cueI].t < now - J.window) {
      const cu = this.cues[this.cueI++];
      if (!cu.judged) this.decided++;
      cu.judged = true;
    }
  }

  snapshot(): ScoreState {
    const { score, combo, maxCombo, notesTaken, decided } = this;
    return { score, combo, maxCombo, counts: { ...this.counts }, notesTaken, decided };
  }

  /**
   * Back at a checkpoint after a death in run `died`: the score is what it was at the checkpoint
   * (everything won since is lost), the combo is broken and every death counts as a MISS.
   */
  continueFrom(at: ScoreState, died: Scorer) {
    this.score = at.score;
    this.combo = 0;
    this.maxCombo = Math.max(at.maxCombo, died.maxCombo);
    this.counts = { ...at.counts, MISS: died.counts.MISS + 1 };
    this.notesTaken = at.notesTaken;
    this.decided = at.decided;
  }

  gem() {
    this.notesTaken++;
    this.score += S.gem;
  }

  private get points() {
    return this.counts.PERFECT + this.counts.GREAT * CONFIG.accuracy.GREAT + this.counts.GOOD * CONFIG.accuracy.GOOD;
  }

  /** Accuracy over the whole song (for the results). */
  get accuracy() {
    return this.points / (this.cues.length || 1);
  }

  /** Accuracy so far: only the cues that are already behind (for the HUD). */
  get liveAccuracy() {
    return this.decided ? this.points / this.decided : 1;
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
