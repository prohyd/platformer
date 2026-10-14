// Builds a level ("chart") from the music analysis.
// Every obstacle is placed so that the press must happen exactly on a beat
// (or on the off-beat between two beats), and the landing happens on a later beat.
import type { Analysis } from '../audio/analyze.ts';

export type Difficulty = 0 | 1 | 2;
export const DIFF_NAMES = ['Лёгкий', 'Нормальный', 'Сложный'];

/** flow: mistakes are forgiven and the song goes on. hardcore: one mistake = start over. */
export type Mode = 'flow' | 'hardcore';
export const MODE_NAMES: Record<Mode, string> = { flow: 'Поток', hardcore: 'Хардкор' };

export const PW = 22;
export const PH = 26;
export const HALF = PW / 2;
export const STEP = 48;
export const SPIKE_H = 28;
/** Height of the gap under a ceiling trap: you fit while running, not while jumping. */
export const CEIL_GAP = 46;
export const CEIL_H = 34;

export interface Floor {
  x0: number;
  x1: number;
  y: number;
}
export interface Pit {
  x0: number;
  x1: number;
  y: number;
}
export interface Spike {
  x: number;
  w: number;
  y: number;
}
/** Spikes hanging from above: punish jumps that the music did not ask for. */
export interface Ceil {
  x: number;
  w: number;
  y: number;
}
export interface Orb {
  x: number;
  y: number;
  t: number;
  v: number;
  offbeat: boolean;
  used: boolean;
}
export interface Pad {
  x: number;
  y: number;
  t: number;
}
export interface Note {
  x: number;
  y: number;
  taken: boolean;
}
/** A moment where the player is expected to press the button. */
export interface Cue {
  t: number;
  x: number;
  y: number;
  kind: 'jump' | 'orb';
  judged: boolean;
}

/** How forgiving the physics are. */
export interface Tolerance {
  orbX: number;
  orbY: number;
  coyote: number;
  buffer: number;
}

export interface Chart {
  mode: Mode;
  tol: Tolerance;
  speed: number;
  beatDur: number;
  airT: number;
  airBeats: number;
  H: number;
  v0: number;
  g: number;
  padV: number;
  beats: number[];
  floors: Floor[];
  pits: Pit[];
  spikes: Spike[];
  ceils: Ceil[];
  orbs: Orb[];
  pads: Pad[];
  notes: Note[];
  cues: Cue[];
  drops: number[];
  duration: number;
  endX: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Params {
  threshold: number;
  minGap: number;
  chainMax: number;
  chainMinEnergy: number;
  pitMargin: number;
  spikeW: number;
  doubleChance: number;
  maxSteps: number;
  ceilChance: number;
  offbeatChance: number;
  easyRest: boolean;
  tol: Tolerance;
  speedMul: number;
}

function params(diff: Difficulty, mode: Mode): Params {
  if (mode === 'flow') {
    return {
      threshold: [0.62, 0.47, 0.36][diff],
      minGap: [2, 1, 1][diff],
      chainMax: [0, 2, 4][diff],
      chainMinEnergy: 0.5,
      pitMargin: 26,
      spikeW: 26,
      doubleChance: diff === 2 ? 0.5 : 0,
      maxSteps: 3,
      ceilChance: 0,
      offbeatChance: 0,
      easyRest: diff === 0,
      tol: { orbX: 44, orbY: 95, coyote: 0.07, buffer: 0.12 },
      speedMul: 1,
    };
  }
  // Hardcore: denser, tighter, and with traps for button mashers.
  return {
    threshold: [0.42, 0.3, 0.2][diff],
    minGap: [1, 0, 0][diff],
    chainMax: [2, 4, 6][diff],
    chainMinEnergy: [0.5, 0.4, 0.3][diff],
    pitMargin: [12, 9, 7][diff],
    spikeW: [36, 38, 40][diff],
    doubleChance: [0.35, 0.6, 0.8][diff],
    maxSteps: 4,
    ceilChance: [0.3, 0.45, 0.6][diff],
    offbeatChance: [0.3, 0.5, 0.65][diff],
    easyRest: false,
    tol: { orbX: [34, 31, 29][diff], orbY: [60, 52, 48][diff], coyote: [0.05, 0.04, 0.035][diff], buffer: [0.09, 0.085, 0.08][diff] },
    speedMul: [1.12, 1.16, 1.2][diff],
  };
}

export function buildChart(an: Analysis, diff: Difficulty, seed: number, mode: Mode = 'flow'): Chart {
  const rand = rng(seed + diff * 7919 + (mode === 'hardcore' ? 104729 : 0));
  const P = params(diff, mode);
  const beatDur = an.beatDur;
  // The jump lasts one beat, or two on fast songs so it never feels twitchy.
  const airBeats = beatDur < 0.4 ? 2 : 1;
  const airT = beatDur * airBeats;
  const speed = Math.max(230, Math.min(420, 150 / beatDur)) * P.speedMul;
  const H = 96;
  const v0 = (4 * H) / airT;
  const g = (8 * H) / (airT * airT);
  const padV = 2 * v0;
  // An orb hit at the top of a jump (half a beat in) that lands two beats after take-off.
  const offV = (-H + 0.5 * g * (1.5 * airT) ** 2) / (1.5 * airT);
  const X = (t: number) => t * speed;

  const floors: Floor[] = [];
  const pits: Pit[] = [];
  const spikes: Spike[] = [];
  const ceils: Ceil[] = [];
  const orbs: Orb[] = [];
  const pads: Pad[] = [];
  const notes: Note[] = [];
  const cues: Cue[] = [];
  const drops: number[] = [];

  let curY = 0;
  let segX = -2000;
  const closeSeg = (x: number) => {
    if (x > segX) floors.push({ x0: segX, x1: x, y: curY });
  };
  const pit = (x0: number, x1: number) => {
    // always leave a strip of ground to land on between two pits
    x0 = Math.max(x0, segX + 24);
    closeSeg(x0);
    pits.push({ x0, x1, y: curY });
    segX = x1;
  };
  const setY = (x: number, y: number) => {
    closeSeg(x);
    curY = y;
    segX = x;
  };
  const arcNote = (t0: number, u: number) => {
    notes.push({ x: X(t0 + u * airT), y: curY + 4 * H * u * (1 - u) + PH / 2, taken: false });
  };

  const beats = an.beats;
  const n = beats.length;
  const pm = P.pitMargin;

  let nextT = mode === 'hardcore' ? 1.6 : 2.2;
  let lastAction = -99;
  let lastLand = -1;
  let padT = 0;
  let quietRun = 0;

  for (let i = 0; i < n - 3 * airBeats; i++) {
    if (beats[i] < nextT) continue;
    const t = beats[i];
    const x = X(t);
    const e = an.smooth[i];
    const strength = 0.45 * an.onset[i] + 0.35 * an.kick[i] + 0.3 * an.energy[i] - (i % 2 ? 0.06 : 0);
    const isDrop = i >= 8 && an.smooth[i] > 0.62 && an.smooth[i] - an.smooth[i - 8] > 0.28 && !drops.some((d) => t - d < beatDur * 16);

    // Big moment in the music: a launch pad, no press needed.
    if (isDrop && i + 2 * airBeats < n && t >= padT) {
      drops.push(t);
      const land = t + 2 * airT;
      pads.push({ x, y: curY, t });
      pit(x + 40, X(land) - 40);
      for (let k = 1; k < 8; k++) notes.push({ x: X(t + (k / 8) * 2 * airT), y: curY + 16 * H * (k / 8) * (1 - k / 8) + PH / 2, taken: false });
      nextT = land - 0.03 + (P.easyRest ? beatDur : 0);
      lastLand = land;
      padT = land + beatDur * 0.9;
      lastAction = i;
      quietRun = 0;
      continue;
    }

    if (strength < P.threshold || i - lastAction < P.minGap * airBeats) {
      quietRun++;
      const settled = t - lastLand > 0.1;
      if (P.ceilChance > 0 && settled && quietRun >= 1 && rand() < P.ceilChance) {
        // A spiky ceiling: you only survive it by NOT jumping.
        const w = 44 + rand() * 40;
        ceils.push({ x: x - w / 2, w, y: curY + CEIL_GAP });
        nextT = t + beatDur * 0.9;
        continue;
      }
      // Calm parts: gems on the beat to keep the rhythm in your body, and gentle drops.
      if (an.onset[i] > 0.3 || an.offbeat[i] > 0.5) notes.push({ x, y: curY + PH / 2, taken: false });
      if (curY > 0 && quietRun > 1 && settled && rand() < 0.35) {
        setY(x + 6, curY - STEP);
        nextT = t + beatDur * 0.9;
        lastLand = t + 0.25;
      }
      continue;
    }
    quietRun = 0;

    // How many following beats are strong enough to chain orbs?
    let chain = 0;
    if (P.chainMax > 0 && e > P.chainMinEnergy) {
      for (let m = 1; m <= P.chainMax; m++) {
        const j = i + m * airBeats;
        if (j >= n - 2 * airBeats) break;
        const s = 0.5 * an.onset[j] + 0.35 * an.kick[j] + 0.3 * an.energy[j];
        if (s >= P.threshold * 0.9) chain++;
        else break;
      }
    }
    const r = rand();
    cues.push({ t, x, y: curY, kind: 'jump', judged: false });
    // The jump physically starts on the beat, or on landing if we are still in the air.
    const ts = Math.max(t, lastLand);
    const xs = X(ts);
    let landT = ts + airT;

    if (P.offbeatChance > 0 && an.offbeat[i] > 0.3 && i + 2 * airBeats < n && rand() < P.offbeatChance) {
      // Off-beat orb at the top of the jump: press between the beats.
      const tm = ts + airT / 2;
      landT = ts + 2 * airT;
      orbs.push({ x: X(tm), y: curY + H + PH / 2, t: tm, v: offV, offbeat: true, used: false });
      cues.push({ t: tm, x: X(tm), y: curY + H, kind: 'orb', judged: false });
      pit(xs + pm, X(landT) - pm);
    } else if (chain > 0 && r < (mode === 'hardcore' ? 0.38 : 0.45)) {
      // Orb chain over the void: press on every beat.
      // Orb times follow the jump physics exactly, so the chain never drifts.
      landT = ts + (chain + 1) * airT;
      for (let m = 1; m <= chain; m++) {
        const tm = ts + m * airT;
        orbs.push({ x: X(tm), y: curY + PH / 2, t: tm, v: v0, offbeat: false, used: false });
        cues.push({ t: tm, x: X(tm), y: curY, kind: 'orb', judged: false });
        notes.push({ x: X(tm - airT / 2), y: curY + H + PH / 2, taken: false });
      }
      pit(xs + pm, X(landT) - pm);
    } else if (r < 0.75 && curY < P.maxSteps * STEP && rand() < 0.5) {
      // Step up: land on a higher floor.
      arcNote(ts, 0.45);
      setY(X(ts + airT * 0.72), curY + STEP);
      landT = ts + airT * 0.86;
    } else if (r < 0.62 || (P.easyRest && r < 0.7)) {
      pit(xs + pm, X(ts + airT) - pm);
      arcNote(ts, 0.5);
    } else {
      const double = rand() < P.doubleChance && e > 0.45;
      const w = double ? P.spikeW + 24 : P.spikeW;
      spikes.push({ x: X(ts + airT / 2) - w / 2, w, y: curY });
      arcNote(ts, 0.5);
    }
    nextT = landT - 0.02 + (P.easyRest ? airT : 0);
    lastLand = landT;
    lastAction = i;
    padT = landT + beatDur * 0.9;
  }

  const endX = X(an.duration) + 200;
  closeSeg(endX + 4000);
  notes.sort((a, b) => a.x - b.x);
  spikes.sort((a, b) => a.x - b.x);
  ceils.sort((a, b) => a.x - b.x);
  orbs.sort((a, b) => a.x - b.x);
  cues.sort((a, b) => a.t - b.t);
  return {
    mode,
    tol: P.tol,
    speed,
    beatDur,
    airT,
    airBeats,
    H,
    v0,
    g,
    padV,
    beats,
    floors,
    pits,
    spikes,
    ceils,
    orbs,
    pads,
    notes,
    cues,
    drops,
    duration: an.duration,
    endX,
  };
}
