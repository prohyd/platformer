// Obstacle patterns (Strategy pattern).
//
// Each pattern decides whether it fits the current beat and, if so, places itself
// using the ChartBuilder helpers. To add a new obstacle, write a new pattern object
// and put it into one of the lists at the bottom of this file.
//
// NB: patterns draw random numbers from b.rand in a fixed order. Changing that order
// changes every generated level (which is fine, but they will look different).
import { CEIL_GAP, HALF, PH, STEP } from '../geometry.ts';
import type { Beat, ChartBuilder } from './ChartBuilder.ts';
import { CONFIG } from '../../config.ts';

/** Where and how the jump that starts an action happens. */
export interface JumpStart {
  /** Random number 0..1 rolled once per action, shared by the patterns below. */
  r: number;
  /** How many following beats are strong enough for an orb chain. */
  chain: number;
  /** Time the runner actually leaves the ground (the beat, or landing if still in the air). */
  ts: number;
  /** World x of the take-off. */
  xs: number;
}

/** A pattern placed on a beat that needs a press. */
export interface JumpPattern {
  readonly name: string;
  /** Returns the landing time if placed, or null to let the next pattern try. */
  place(b: ChartBuilder, beat: Beat, jump: JumpStart): number | null;
}

/** A pattern placed on a calm beat (no press needed). */
export interface QuietPattern {
  readonly name: string;
  /** Returns true if this beat is used up and later quiet patterns must be skipped. */
  place(b: ChartBuilder, beat: Beat): boolean;
}

/** A pattern for a big moment in the music. */
export interface AccentPattern {
  readonly name: string;
  /** Returns true if placed (the beat is used up). */
  place(b: ChartBuilder, beat: Beat): boolean;
}

// ===================================================================== accents

/** On a drop: a launch pad throws the runner high, no press needed. */
export const LaunchPad: AccentPattern = {
  name: 'Прыжковая площадка',
  place(b, beat) {
    const { an } = b;
    const { i, t, x } = beat;
    const D = CONFIG.drops;
    const n = an.beats.length;
    const isDrop =
      i >= 8 && an.smooth[i] > D.minEnergy && an.smooth[i] - an.smooth[i - 8] > D.rise && !b.drops.some((d) => t - d < b.beatDur * D.cooldownBeats);
    if (!(isDrop && i + 2 * b.airBeats < n && t >= b.padT)) return false;
    b.drops.push(t);
    const land = t + 2 * b.airT;
    b.pads.push({ x, y: b.curY, t });
    b.pit(x + 40, b.X(land) - 40);
    for (let k = 1; k < 8; k++) {
      const u = k / 8;
      b.addNote(b.X(t + u * 2 * b.airT), b.curY + 16 * b.H * u * (1 - u) + PH / 2);
    }
    b.nextT = land - 0.03 + (b.P.easyRest ? b.beatDur : 0);
    b.lastLand = land;
    b.padT = land + b.beatDur * 0.9;
    b.lastAction = i;
    b.quietRun = 0;
    return true;
  },
};

// ===================================================================== calm beats

/** Spikes hanging from above: survived only by NOT jumping. Punishes button mashing. */
export const CeilingTrap: QuietPattern = {
  name: 'Шипастый потолок',
  place(b, beat) {
    const cw = 44 + b.rand() * 40;
    // the whole ceiling must start after the hero has landed, not just its middle
    const clear = beat.x - cw / 2 > b.X(b.lastLand) + HALF + 12;
    if (!(b.P.ceilChance > 0 && clear && b.quietRun >= 1 && b.rand() < b.P.ceilChance)) return false;
    b.ceils.push({ x: beat.x - cw / 2, w: cw, y: b.curY + CEIL_GAP });
    b.nextT = beat.t + b.beatDur * 0.9;
    return true;
  },
};

/** A gem on an audible beat, so you feel the rhythm even when nothing happens. */
export const BeatGem: QuietPattern = {
  name: 'Кристалл на доле',
  place(b, beat) {
    const { an } = b;
    if (an.onset[beat.i] > 0.3 || an.offbeat[beat.i] > 0.5) b.addNote(beat.x, b.curY + PH / 2);
    return false;
  },
};

/** After a while on a raised floor, gently step back down. */
export const StepDown: QuietPattern = {
  name: 'Ступенька вниз',
  place(b, beat) {
    const settled = beat.t - b.lastLand > 0.1;
    if (!(b.curY > 0 && b.quietRun > 1 && settled && b.rand() < 0.35)) return false;
    b.setY(beat.x + 6, b.curY - STEP);
    b.nextT = beat.t + b.beatDur * 0.9;
    b.lastLand = beat.t + 0.25;
    return true;
  },
};

// ===================================================================== jumps

/** A pink orb at the top of the jump: the second press falls between two beats. */
export const OffbeatOrb: JumpPattern = {
  name: 'Кольцо между долями',
  place(b, beat, { ts, xs }) {
    const n = b.an.beats.length;
    if (!(b.P.offbeatChance > 0 && b.an.offbeat[beat.i] > 0.3 && beat.i + 2 * b.airBeats < n && b.rand() < b.P.offbeatChance)) return null;
    const tm = ts + b.airT / 2;
    const landT = ts + 2 * b.airT;
    b.orbs.push({ x: b.X(tm), y: b.curY + b.H + PH / 2, t: tm, v: b.offV, offbeat: true, used: false });
    b.addCue(tm, b.curY + b.H, 'orb');
    b.pit(xs + b.P.pitMargin, b.X(landT) - b.P.pitMargin);
    return landT;
  },
};

/** A chain of orbs over the void: one press on every beat. */
export const OrbChain: JumpPattern = {
  name: 'Цепочка колец',
  place(b, _beat, { r, chain, ts, xs }) {
    if (!(chain > 0 && r < b.P.chainChance)) return null;
    // orb times follow the jump physics exactly, so the chain never drifts
    const landT = ts + (chain + 1) * b.airT;
    for (let m = 1; m <= chain; m++) {
      const tm = ts + m * b.airT;
      b.orbs.push({ x: b.X(tm), y: b.curY + PH / 2, t: tm, v: b.v0, offbeat: false, used: false });
      b.addCue(tm, b.curY, 'orb');
      b.addNote(b.X(tm - b.airT / 2), b.curY + b.H + PH / 2);
    }
    b.pit(xs + b.P.pitMargin, b.X(landT) - b.P.pitMargin);
    return landT;
  },
};

/** Jump onto a higher floor. */
export const StepUp: JumpPattern = {
  name: 'Ступенька вверх',
  place(b, _beat, { r, ts }) {
    if (!(r < 0.75 && b.curY < b.P.maxSteps * STEP && b.rand() < b.P.stepChance)) return null;
    b.arcNote(ts, 0.45);
    b.setY(b.X(ts + b.airT * 0.72), b.curY + STEP);
    return ts + b.airT * 0.86;
  },
};

/** Jump over a pit, landing on the next beat. */
export const PitJump: JumpPattern = {
  name: 'Пропасть',
  place(b, _beat, { r, ts, xs }) {
    if (!(r < b.P.pitShare)) return null;
    b.pit(xs + b.P.pitMargin, b.X(ts + b.airT) - b.P.pitMargin);
    b.arcNote(ts, 0.5);
    return ts + b.airT;
  },
};

/** Jump over spikes (sometimes a double row). Always fits, so it is the last resort. */
export const SpikeJump: JumpPattern = {
  name: 'Шипы',
  place(b, beat, { ts }) {
    const double = b.rand() < b.P.doubleChance && beat.energy > 0.45;
    const w = double ? b.P.spikeW + 24 : b.P.spikeW;
    b.spikes.push({ x: b.X(ts + b.airT / 2) - w / 2, w, y: b.curY });
    b.arcNote(ts, 0.5);
    return ts + b.airT;
  },
};

// ===================================================================== order

/** Tried first on every beat. */
export const ACCENT_PATTERNS: AccentPattern[] = [LaunchPad];
/** Tried on calm beats, in order, until one returns true. */
export const QUIET_PATTERNS: QuietPattern[] = [CeilingTrap, BeatGem, StepDown];
/** Tried on beats that need a press, in order; the first one that fits is used. */
export const JUMP_PATTERNS: JumpPattern[] = [OffbeatOrb, OrbChain, StepUp, PitJump, SpikeJump];
