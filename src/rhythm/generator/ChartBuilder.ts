// The "construction site" of a level: geometry helpers and the state of the pacing.
// Patterns (see patterns.ts) call these helpers to place obstacles.
import type { Analysis } from '../../audio/analyze.ts';
import { CONFIG, type LevelParams } from '../../config.ts';
import { PH } from '../geometry.ts';
import type { Ceil, Chart, Cue, Floor, Mode, Note, Orb, Pad, Pit, Spike } from '../types.ts';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the conductor knows about the current beat. */
export interface Beat {
  /** Index in the beat list. */
  i: number;
  /** Time of the beat. */
  t: number;
  /** World x of the beat. */
  x: number;
  /** Smoothed loudness around the beat, 0..1. */
  energy: number;
  /** How strongly this beat "asks" for an action, 0..1. */
  strength: number;
}

export class ChartBuilder {
  readonly an: Analysis;
  readonly mode: Mode;
  /** Parameters of the chosen difficulty (from config). */
  readonly P: LevelParams;
  readonly rand: () => number;

  // ---- physics of this song
  readonly beatDur: number;
  readonly airBeats: number;
  readonly airT: number;
  readonly speed: number;
  readonly H: number;
  readonly v0: number;
  readonly g: number;
  readonly padV: number;
  /** Velocity of an off-beat orb hit at the top of a jump that lands two beats after take-off. */
  readonly offV: number;

  // ---- the level being built
  readonly floors: Floor[] = [];
  readonly pits: Pit[] = [];
  readonly spikes: Spike[] = [];
  readonly ceils: Ceil[] = [];
  readonly orbs: Orb[] = [];
  readonly pads: Pad[] = [];
  readonly notes: Note[] = [];
  readonly cues: Cue[] = [];
  readonly drops: number[] = [];

  /** Height of the floor at the building cursor. */
  curY = 0;
  /** Where the current floor segment started. */
  private segX = -2000;

  // ---- pacing
  /** No new action before this time. */
  nextT: number;
  /** Beat index of the last action. */
  lastAction = -99;
  /** When the runner touches the ground after the last action. */
  lastLand = -1;
  /** No launch pad before this time. */
  padT = 0;
  /** How many calm beats in a row. */
  quietRun = 0;

  constructor(an: Analysis, mode: Mode, P: LevelParams, seed: number) {
    this.an = an;
    this.mode = mode;
    this.P = P;
    this.rand = rng(seed);
    const SP = CONFIG.speed;
    this.beatDur = an.beatDur;
    // The jump lasts one beat, or two on fast songs so it never feels twitchy.
    this.airBeats = this.beatDur < SP.twoBeatJumpBelow ? 2 : 1;
    this.airT = this.beatDur * this.airBeats;
    this.speed = Math.max(SP.min, Math.min(SP.max, SP.pixelsPerBeat / this.beatDur)) * P.speedMul;
    this.H = CONFIG.player.jumpHeight;
    this.v0 = (4 * this.H) / this.airT;
    this.g = (8 * this.H) / (this.airT * this.airT);
    this.padV = 2 * this.v0;
    this.offV = (-this.H + 0.5 * this.g * (1.5 * this.airT) ** 2) / (1.5 * this.airT);
    this.nextT = CONFIG.timing.firstObstacle[mode];
  }

  /** World x at song time t. */
  X(t: number) {
    return t * this.speed;
  }

  // ---------------------------------------------------------------- geometry

  private closeSeg(x: number) {
    if (x > this.segX) this.floors.push({ x0: this.segX, x1: x, y: this.curY });
  }

  /** Cut a pit into the floor. */
  pit(x0: number, x1: number) {
    // always leave a strip of ground to land on between two pits
    x0 = Math.max(x0, this.segX + CONFIG.world.minLandingStrip);
    this.closeSeg(x0);
    this.pits.push({ x0, x1, y: this.curY });
    this.segX = x1;
  }

  /** Change the floor height from x onwards (a step up or down). */
  setY(x: number, y: number) {
    this.closeSeg(x);
    this.curY = y;
    this.segX = x;
  }

  /** A gem on the arc of a jump that starts at t0; u = 0..1 along the jump. */
  arcNote(t0: number, u: number) {
    this.notes.push({ x: this.X(t0 + u * this.airT), y: this.curY + 4 * this.H * u * (1 - u) + PH / 2, taken: false });
  }

  addNote(x: number, y: number) {
    this.notes.push({ x, y, taken: false });
  }

  addCue(t: number, y: number, kind: Cue['kind']) {
    this.cues.push({ t, x: this.X(t), y, kind, judged: false });
  }

  // ---------------------------------------------------------------- pacing

  /** Bookkeeping after an action that needs a press: the runner lands at landT. */
  finishAction(beat: Beat, landT: number) {
    this.nextT = landT - 0.02 + (this.P.easyRest ? this.airT : 0);
    this.lastLand = landT;
    this.lastAction = beat.i;
    this.padT = landT + this.beatDur * 0.9;
  }

  // ---------------------------------------------------------------- result

  build(): Chart {
    const endX = this.X(this.an.duration) + 200;
    this.closeSeg(endX + 4000);
    this.notes.sort((a, b) => a.x - b.x);
    this.spikes.sort((a, b) => a.x - b.x);
    this.ceils.sort((a, b) => a.x - b.x);
    this.orbs.sort((a, b) => a.x - b.x);
    this.cues.sort((a, b) => a.t - b.t);
    return {
      mode: this.mode,
      tol: this.P.tolerance,
      speed: this.speed,
      beatDur: this.beatDur,
      airT: this.airT,
      airBeats: this.airBeats,
      H: this.H,
      v0: this.v0,
      g: this.g,
      padV: this.padV,
      beats: this.an.beats,
      floors: this.floors,
      pits: this.pits,
      spikes: this.spikes,
      ceils: this.ceils,
      orbs: this.orbs,
      pads: this.pads,
      notes: this.notes,
      cues: this.cues,
      drops: this.drops,
      duration: this.an.duration,
      endX,
    };
  }
}
