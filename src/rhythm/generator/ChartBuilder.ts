// The "construction site" of a level: physics of the song, geometry helpers and speed portals.
// Patterns (see patterns.ts) call these helpers to place obstacles.
import type { Analysis } from '../../audio/analyze.ts';
import { CONFIG, type LevelParams } from '../../config.ts';
import { CEIL_GAP, HALF, PH } from '../geometry.ts';
import { xAt } from '../speed.ts';
import type { Ceil, Chart, ChartSection, Cue, Floor, Mode, Note, Orb, Pad, Pit, PlacedPattern, SpeedSeg, Spike } from '../types.ts';

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

export class ChartBuilder {
  readonly an: Analysis;
  readonly mode: Mode;
  /** Parameters of the chosen difficulty (from config). */
  readonly P: LevelParams;
  readonly rand: () => number;

  // ---- physics of this song
  readonly beatDur: number;
  /** How many beats one jump lasts (1, or 2 on fast songs). */
  readonly airBeats: number;
  /** Length of one jump, s. Patterns are laid out on a grid of half jumps. */
  readonly airT: number;
  /** Half a jump, s: one step of the pattern grid. */
  readonly half: number;
  /** Base running speed, px/s. */
  readonly speed: number;
  readonly H: number;
  readonly v0: number;
  readonly g: number;

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
  readonly speeds: SpeedSeg[];
  readonly sections: ChartSection[] = [];
  readonly patterns: PlacedPattern[] = [];

  /** Height of the floor at the building cursor. */
  curY = 0;
  /** Where the current floor segment started. */
  private segX = -1e6;
  /** When the runner is back on the ground after the last thing placed. */
  readyT = -1;

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
    this.half = this.airT / 2;
    this.speed = Math.max(SP.min, Math.min(SP.max, SP.pixelsPerBeat / this.beatDur)) * P.speedMul;
    this.H = CONFIG.player.jumpHeight;
    this.v0 = (4 * this.H) / this.airT;
    this.g = (8 * this.H) / (this.airT * this.airT);
    this.speeds = [{ t: -1000, x: -1000 * this.speed, speed: this.speed, mul: 1 }];
  }

  /** World x at song time t. */
  X(t: number) {
    return xAt(this.speeds, t);
  }

  /** Current running speed (px/s) at the end of the level built so far. */
  get curSpeed() {
    return this.speeds[this.speeds.length - 1].speed;
  }

  /** A speed portal: from time t the runner moves `mul` times the base speed. */
  setSpeed(t: number, mul: number) {
    const last = this.speeds[this.speeds.length - 1];
    if (Math.abs(last.mul - mul) < 1e-3 || t <= last.t) return;
    this.speeds.push({ t, x: this.X(t), speed: this.speed * mul, mul });
  }

  // ---------------------------------------------------------------- geometry

  private closeSeg(x: number) {
    if (x > this.segX) this.floors.push({ x0: this.segX, x1: x, y: this.curY });
  }

  /** Cut a pit into the floor. */
  pit(x0: number, x1: number) {
    // always leave a strip of ground to land on between two pits
    x0 = Math.max(x0, this.segX + CONFIG.world.minLandingStrip);
    if (x1 <= x0) return;
    this.closeSeg(x0);
    this.pits.push({ x0, x1, y: this.curY });
    this.segX = x1;
  }

  /** Change the floor height from x onwards (a step up or down). */
  setY(x: number, y: number) {
    this.closeSeg(x);
    this.curY = y;
    this.segX = Math.max(this.segX, x);
  }

  /** Spikes centred at x; never wider than a jump at the current speed can clear. */
  spike(xc: number, w: number) {
    const most = 0.8 * this.airT * this.curSpeed - 2 * HALF - 8;
    w = Math.max(18, Math.min(w, most));
    this.spikes.push({ x: xc - w / 2, w, y: this.curY });
  }

  /** Spikes hanging over the run between x0 and x1: pass only by not jumping. */
  ceiling(x0: number, x1: number) {
    const y = this.curY + CEIL_GAP;
    const last = this.ceils[this.ceils.length - 1];
    // two ceilings close together become one long tunnel
    if (last && last.y === y && x0 - (last.x + last.w) < 4 * HALF + 20) {
      last.w = x1 - last.x;
      return;
    }
    this.ceils.push({ x: x0, w: x1 - x0, y });
  }

  orb(t: number, y: number, v: number, offbeat: boolean) {
    this.orbs.push({ x: this.X(t), y: y + PH / 2, t, v, offbeat, used: false });
    this.addCue(t, y, 'orb');
  }

  pad(t: number, v: number, big: boolean) {
    this.pads.push({ x: this.X(t), y: this.curY, t, v, big });
  }

  addNote(x: number, y: number) {
    this.notes.push({ x, y, taken: false });
  }

  addCue(t: number, y: number, kind: Cue['kind']) {
    this.cues.push({ t, x: this.X(t), y, kind, judged: false });
  }

  // ---------------------------------------------------------------- result

  build(): Chart {
    const endX = this.X(this.an.duration) + 200;
    this.closeSeg(endX + 4000);
    this.notes.sort((a, b) => a.x - b.x);
    this.spikes.sort((a, b) => a.x - b.x);
    this.ceils.sort((a, b) => a.x - b.x);
    this.orbs.sort((a, b) => a.x - b.x);
    this.pads.sort((a, b) => a.x - b.x);
    this.cues.sort((a, b) => a.t - b.t);
    return {
      mode: this.mode,
      tol: this.P.tolerance,
      speed: this.speed,
      speeds: this.speeds,
      sections: this.sections,
      beatDur: this.beatDur,
      airT: this.airT,
      airBeats: this.airBeats,
      H: this.H,
      v0: this.v0,
      g: this.g,
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
      patterns: this.patterns,
    };
  }
}
