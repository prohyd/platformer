// The pattern library: short pieces of level (a bar or two long) written in a tiny language.
//
// A pattern is a list of tokens separated by spaces. The level is laid out on a grid of
// HALF JUMPS ("steps"): one jump = 2 steps = one beat (two beats on fast songs).
//
//   Running (no press)                     Jumps (one press at the start, 2 steps)
//   _   run 1 step                         S  spikes            P  pit
//   -   run 2 steps                        D  double spikes     x  spikes or pit (random)
//   c   run 2 steps under a spiked         T  triple spikes     U  jump onto a step up
//       ceiling (pressing here = death)    W  jump down a step over a pit (3 steps)
//   d   walk off a step down (1 step)
//
//   In the air: {…} starts with a jump (press), <…> with a small pad, […] with a big pad.
//   Inside, every character is the next step:
//     .        flying
//     0-9 a-g  an orb (press) at this height, in quarters of a jump (4 = top of a normal jump)
//     v ^ _    landing: on the same floor / one step higher / one step lower (always last)
//   Orb velocities are computed so that the runner passes exactly through the next orb
//   and lands exactly on the grid, so every pattern is in time with the music by design.
//
//   Examples: "{.0.0.v}" = jump + two orbs over a pit, every beat;
//             "{444v}"   = jump + three orbs at the top of the jump, every half beat.
//
// Every pattern is checked when the game starts (see parsePattern): impossible ones throw.
import { CONFIG } from '../../config.ts';
import { HALF, PH, STEP } from '../geometry.ts';
import type { ChartBuilder } from './ChartBuilder.ts';

// ===================================================================== types

type GroundJump = 'S' | 'D' | 'T' | 'P' | 'x' | 'U' | 'W';

/** An orb on an air path: at grid step `k`, height `y` (in jump heights), leaving with velocity `v`. */
interface AirOrb {
  k: number;
  y: number;
  v: number;
}

type Token =
  | { kind: 'run'; steps: number; ceil: boolean }
  | { kind: 'down' }
  | { kind: 'jump'; what: GroundJump }
  | {
      kind: 'air';
      /** How it starts: a press, a small pad or a big pad. */
      open: 'jump' | 'pad' | 'bigpad';
      v0: number;
      orbs: AirOrb[];
      /** Landing step and floor change (-1, 0, +1 steps). */
      land: number;
      dy: number;
      /** Velocity of the last flight to the ground. */
      vLand: number;
    };

export type Family = 'rest' | 'ground' | 'steps' | 'orbs' | 'fast' | 'pad' | 'ceil';

export interface Pattern {
  readonly name: string;
  readonly source: string;
  readonly tokens: Token[];
  /** Length in grid steps (a multiple of 4 = half a bar). */
  readonly steps: number;
  /** Grid steps where the player has to press. */
  readonly clicks: number[];
  /** 0 = single jumps … 4 = long fast chains. */
  readonly tier: number;
  readonly families: Family[];
  /** Presses between the beats (odd steps). */
  readonly offbeat: boolean;
  /** The most orbs in one air path. */
  readonly chain: number;
  readonly ceilings: boolean;
  /** Lowest and highest floor reached, and the final floor, in steps relative to the start. */
  readonly minY: number;
  readonly maxY: number;
  readonly netY: number;
}

// ===================================================================== physics in jump units
// Time is measured in jumps (T = 1), height in jump heights (H = 1).
// A normal jump: v0 = 4, g = 8, it lands after 1 and peaks at 1 after 0.5.

const G = 8;
const V_JUMP = 4;
const V_PAD = 6; // lands after 1.5 jumps
const V_BIGPAD = 8; // lands after 2 jumps
const STEP_H = STEP / CONFIG.player.jumpHeight;
/** Grid step in jumps. */
const DT = 0.5;

const heightAt = (y: number, v: number, s: number) => y + v * s - (G / 2) * s * s;
/** Velocity that takes you from height y0 to y1 in time s. */
const velocityFor = (y0: number, y1: number, s: number) => (y1 - y0 + (G / 2) * s * s) / s;

function parseAir(src: string, where: string): Extract<Token, { kind: 'air' }> {
  const open = src[0] === '{' ? 'jump' : src[0] === '<' ? 'pad' : 'bigpad';
  const v0 = open === 'jump' ? V_JUMP : open === 'pad' ? V_PAD : V_BIGPAD;
  const body = src.slice(1, -1);
  const fail = (msg: string) => {
    throw new Error(`pattern "${where}": ${msg}`);
  };
  // collect the key points: take-off, orbs, landing
  const pts: { k: number; y: number; orb: boolean }[] = [{ k: 0, y: 0, orb: false }];
  let land = -1;
  let dy = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const k = i + 1;
    if (ch === '.') continue;
    if (ch === 'v' || ch === '^' || ch === '_') {
      if (i !== body.length - 1) fail('the landing must be the last character');
      land = k;
      dy = ch === '^' ? 1 : ch === '_' ? -1 : 0;
      pts.push({ k, y: dy * STEP_H, orb: false });
    } else {
      const q = parseInt(ch, 17);
      if (Number.isNaN(q)) fail(`unknown character "${ch}"`);
      pts.push({ k, y: q / 4, orb: true });
    }
  }
  if (land < 0) fail('no landing (v, ^ or _)');
  // the first flight is pure physics: the first point must be where the jump really goes
  const first = pts[1];
  const yFirst = heightAt(0, v0, first.k * DT);
  if (Math.abs(yFirst - first.y) > 0.02) fail(`the first point at step ${first.k} must be at height ${Math.round(yFirst * 4)} quarters`);
  const orbs: AirOrb[] = [];
  let vLand = v0;
  let lowest = 0;
  for (let p = 1; p < pts.length - 1; p++) {
    const a = pts[p];
    const b = pts[p + 1];
    const s = (b.k - a.k) * DT;
    const v = velocityFor(a.y, b.y, s);
    if (v < -1e-6) fail(`the orb at step ${a.k} would have to push down`);
    orbs.push({ k: a.k, y: a.y, v });
    vLand = v;
    // lowest point of the flight (it never goes below the floor much: that would be a fall)
    lowest = Math.min(lowest, heightAt(a.y, v, s));
  }
  if (lowest < -0.6) fail('the path dips too low');
  // the last flight must come down on the landing, not hit it from the side
  const last = pts[pts.length - 2];
  const sl = (land - last.k) * DT;
  if (dy > 0 && heightAt(last.y, vLand, sl - 0.12) < STEP_H + 0.1) fail('cannot reach the step up');
  if (vLand - G * sl > -0.5) fail('the landing is not a fall');
  return { kind: 'air', open, v0, orbs, land, dy, vLand };
}

// ===================================================================== parsing

/** Reads a pattern source; throws if it is impossible to play. */
export function parsePattern(name: string, source: string, tierOverride?: number): Pattern {
  const tokens: Token[] = [];
  const clicks: number[] = [];
  const families = new Set<Family>();
  let steps = 0;
  let y = 0;
  let minY = 0;
  let maxY = 0;
  let chain = 0;
  let ceilings = false;
  let maxOrbY = 0;
  let pads = false;
  for (const part of source.trim().split(/\s+/)) {
    const c0 = part[0];
    if (c0 === '{' || c0 === '<' || c0 === '[') {
      const air = parseAir(part, name);
      tokens.push(air);
      if (air.open === 'jump') clicks.push(steps);
      else {
        families.add('pad');
        pads = true;
      }
      for (const o of air.orbs) {
        clicks.push(steps + o.k);
        maxOrbY = Math.max(maxOrbY, o.y);
      }
      chain = Math.max(chain, air.orbs.length);
      if (air.orbs.length) families.add(air.orbs.some((o) => o.k % 2) ? 'fast' : 'orbs');
      if (air.dy) families.add('steps');
      steps += air.land;
      y += air.dy;
    } else if (part === '_' || part === '-' || part === 'c') {
      tokens.push({ kind: 'run', steps: part === '_' ? 1 : 2, ceil: part === 'c' });
      steps += part === '_' ? 1 : 2;
      if (part === 'c') {
        ceilings = true;
        families.add('ceil');
      }
    } else if (part === 'd') {
      tokens.push({ kind: 'down' });
      steps += 1;
      y -= 1;
      families.add('steps');
    } else if ('SDTPxUW'.includes(part) && part.length === 1) {
      const what = part as GroundJump;
      tokens.push({ kind: 'jump', what });
      clicks.push(steps);
      steps += what === 'W' ? 3 : 2;
      if (what === 'U') y += 1;
      if (what === 'W') y -= 1;
      families.add(what === 'U' || what === 'W' ? 'steps' : 'ground');
    } else {
      throw new Error(`pattern "${name}": unknown token "${part}"`);
    }
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // fill up to half a bar so patterns always start on strong beats
  const padded = Math.ceil(steps / 4) * 4;
  if (padded > steps) tokens.push({ kind: 'run', steps: padded - steps, ceil: false });
  if (!clicks.length) families.add('rest');

  // ---- how hard is it
  const offbeat = clicks.some((k) => k % 2 === 1);
  let fastRun = 1;
  let longestFast = clicks.length ? 1 : 0;
  let backToBack = false;
  for (let i = 1; i < clicks.length; i++) {
    const d = clicks[i] - clicks[i - 1];
    fastRun = d === 1 ? fastRun + 1 : 1;
    longestFast = Math.max(longestFast, fastRun);
    if (d <= 2) backToBack = true;
  }
  let tier = 0;
  if (backToBack || families.has('steps') || pads) tier = 1;
  if (families.has('orbs') || tokens.some((t) => t.kind === 'jump' && t.what === 'T') || clicks.length >= 6) tier = 2;
  if (offbeat || ceilings || maxOrbY >= 2) tier = 3;
  if (longestFast >= 5 || (offbeat && clicks.length >= 8)) tier = 4;
  if (tierOverride !== undefined) tier = tierOverride;

  return {
    name,
    source,
    tokens,
    steps: padded,
    clicks,
    tier,
    families: [...families],
    offbeat,
    chain,
    ceilings,
    minY,
    maxY,
    netY: y,
  };
}

// ===================================================================== placing

/** Where the hero is during the placement of a pattern. */
interface Cursor {
  /** Time of the current grid step. */
  t: number;
  /** Grid step inside the pattern. */
  k: number;
}

/**
 * Builds the pattern into the level starting at time t0.
 * Returns the time when the hero is back on the ground for good.
 */
export function placePattern(b: ChartBuilder, p: Pattern, t0: number): number {
  const cur: Cursor = { t: t0, k: 0 };
  const h = b.half;
  const T = b.airT;
  const margin = b.P.pitMargin;
  let ready = t0;
  const stepT = (k: number) => t0 + k * h;
  for (const tok of p.tokens) {
    const ts = cur.t;
    const xs = b.X(ts);
    switch (tok.kind) {
      case 'run': {
        if (tok.ceil) b.ceiling(b.X(ts + 0.1 * T) + HALF, b.X(ts + tok.steps * h - 0.15 * T) - HALF);
        for (let k = 0; k < tok.steps; k++) runGem(b, stepT(cur.k + k));
        break;
      }
      case 'down': {
        b.setY(xs + 6, b.curY - STEP);
        ready = ts + 0.36 * T;
        break;
      }
      case 'jump': {
        b.addCue(ts, b.curY, 'jump');
        ready = placeJump(b, tok.what, ts, xs, margin);
        break;
      }
      case 'air': {
        ready = placeAir(b, tok, ts, xs, margin);
        break;
      }
    }
    const len = tok.kind === 'run' ? tok.steps : tok.kind === 'down' ? 1 : tok.kind === 'jump' ? (tok.what === 'W' ? 3 : 2) : tok.land;
    cur.k += len;
    cur.t = stepT(cur.k);
  }
  return ready;
}

/** A gem on an audible beat while running, so you feel the rhythm even when nothing happens. */
function runGem(b: ChartBuilder, t: number) {
  const an = b.an;
  const i = beatIndexAt(b, t);
  if (i < 0) return;
  if (Math.abs(an.beats[i] - t) < 0.02 && (an.onset[i] > 0.3 || an.offbeat[i] > 0.5)) b.addNote(b.X(t), b.curY + PH / 2);
}

function beatIndexAt(b: ChartBuilder, t: number) {
  const beats = b.an.beats;
  let lo = 0;
  let hi = beats.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t + 0.03) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A gem on a jump arc that starts at t0 from height y0 with velocity v; s = time after take-off. */
function arcGem(b: ChartBuilder, t0: number, y0: number, v: number, s: number) {
  b.addNote(b.X(t0 + s), y0 + v * s - (b.g / 2) * s * s + PH / 2);
}

function placeJump(b: ChartBuilder, what: GroundJump, ts: number, xs: number, margin: number): number {
  const T = b.airT;
  const y0 = b.curY;
  if (what === 'x') what = b.rand() < 0.5 ? 'S' : 'P';
  switch (what) {
    case 'S':
    case 'D':
    case 'T': {
      const w = b.P.spikeW + (what === 'D' ? 24 : what === 'T' ? 48 : 0);
      b.spike(b.X(ts + T / 2), w);
      arcGem(b, ts, y0, b.v0, T / 2);
      return ts + T;
    }
    case 'P':
      b.pit(xs + margin, b.X(ts + T) - margin);
      arcGem(b, ts, y0, b.v0, T / 2);
      return ts + T;
    case 'U':
      arcGem(b, ts, y0, b.v0, T * 0.45);
      b.setY(b.X(ts + T * 0.72), y0 + STEP);
      return ts + T * 0.86;
    case 'W': {
      // from y0 down to y0 - STEP: 4u - 4u² = -STEP/H → u ≈ 1.11
      const u = (1 + Math.sqrt(1 + STEP_H)) / 2;
      const x1 = b.X(ts + u * T) - margin;
      b.pit(xs + margin, x1);
      b.setY(x1, y0 - STEP);
      arcGem(b, ts, y0, b.v0, T / 2);
      return ts + u * T;
    }
  }
}

function placeAir(b: ChartBuilder, tok: Extract<Token, { kind: 'air' }>, ts: number, xs: number, margin: number): number {
  const T = b.airT;
  const h = b.half;
  const H = b.H;
  const y0 = b.curY;
  // velocities scale from jump units: v[H/T] → px/s
  const vel = (v: number) => (v * H) / T;
  if (tok.open === 'jump') b.addCue(ts, y0, 'jump');
  else b.pad(ts, vel(tok.v0), tok.open === 'bigpad');
  let from = { t: ts, y: y0, v: vel(tok.v0) };
  for (const o of tok.orbs) {
    const t = ts + o.k * h;
    arcGem(b, from.t, from.y, from.v, (t - from.t) / 2);
    const v = vel(o.v);
    // an orb exactly between two beats is pink
    b.orb(t, y0 + o.y * H, v, o.k % 2 === 1 && b.airBeats === 1);
    from = { t, y: y0 + o.y * H, v };
  }
  const landT = ts + tok.land * h;
  if (tok.orbs.length) arcGem(b, from.t, from.y, from.v, (landT - from.t) / 2);
  else arcGem(b, ts, y0, from.v, (landT - ts) / 2);
  const x0 = tok.open === 'jump' ? xs + margin : xs + 36;
  const x1 = b.X(landT) - margin;
  b.pit(x0, x1);
  if (tok.dy) b.setY(x1, y0 + tok.dy * STEP);
  return landT;
}

// ===================================================================== the library
//
// [name, source, tier override?]. Order does not matter: the conductor (buildChart.ts)
// picks whatever fits the music best. Add new lines freely, they are checked on start.

const LIBRARY: [string, string, number?][] = [
  // ---------------------------------------------------------------- rest
  ['Пробежка', '- - - -'],
  ['Короткая пробежка', '- -'],
  ['Сход со ступени', 'd _ - -'],
  ['Двойной сход', 'd _ d _'],
  ['Трамплин', '[...v] - -'],
  ['Малый трамплин', '<..v> _'],
  ['Два малых трамплина', '<..v> _ <..v> _'],
  ['Тоннель', 'c c c c'],
  ['Короткий тоннель', '- c'],

  // ---------------------------------------------------------------- single jumps
  ['Шип', 'S - -'],
  ['Пропасть', 'P - -'],
  ['Шип на долю', 'S -'],
  ['Пропасть на долю', 'P -'],
  ['Ступенька', 'U -'],
  ['Что-то на пути', 'x -'],
  ['Шип и пропасть', 'S - P -'],
  ['Две пропасти', 'P - P -'],
  ['Два шипа', 'S - S -'],
  ['Лесенка с отдыхом', 'U - U -'],
  ['Подъём и сход', 'U - d _'],
  ['Шип в конце такта', '- - S -'],
  ['Пропасть в конце такта', '- - P -'],
  ['Отбивка', '- S'],
  ['Квадрат', 'S - S - S - S -'],
  ['Квадрат пропастей', 'P - P - P - P -'],
  ['Лестница с площадками', 'U - U - U - - -'],
  ['Шип и ступень с отдыхом', 'S - U -'],
  ['Спрыгнуть', 'W _'],
  ['Спрыгнуть дважды', 'W _ W _'],
  ['Большой шип', 'D - -'],

  // ---------------------------------------------------------------- back to back
  ['Шип-шип', 'S S'],
  ['Пропасть-пропасть', 'P P'],
  ['Тройка пропастей', 'P P P -'],
  ['Четыре пропасти', 'P P P P'],
  ['Восьмёрка', 'P P P P P P P P'],
  ['Шип-пропасть-шип', 'S P S -'],
  ['Галоп', 'S S - S S -'],
  ['Разгон', 'S S S S'],
  ['Лестница', 'U U U -'],
  ['Ступень и шип', 'U S'],
  ['Шип и ступень', 'S U'],
  ['Пропасть и ступень', 'P U'],
  ['Вверх-вниз', 'U W _'],
  ['Пила', 'U W _ U W _'],
  ['Двойные шипы', 'D D'],
  ['Широкий шип', 'T -'],
  ['Шипы растут', 'S D T -'],
  ['Шипы на подъёме', 'S U S U'],
  ['Плато', 'U - - W _'],
  ['Мост над пропастями', 'U P P W _'],
  ['Каскад', 'U U W _ W _'],
  ['Шип на ступени', 'U S d _ -'],
  ['Обрыв и шип', 'd _ S -'],
  ['Смесь', 'x x x x'],
  ['Двойка и пауза', 'P P - -'],
  ['Пауза и двойка', '- - S S'],

  // ---------------------------------------------------------------- syncopation (presses between beats)
  ['Синкопа', 'S _ S _ -'],
  ['Синкопа с пропастью', 'P _ P _ -'],
  ['Отскок', '_ S _ -'],
  ['Ступенька на слабую', 'U _ S _ -'],
  ['Сбивка', 'S S _ S _'],
  ['Сбивка с пропастью', 'P P _ P _'],
  ['Акцент на слабую', '_ S _ S - -'],
  ['Ломаный ритм', 'S _ P _ S _ P _'],

  // ---------------------------------------------------------------- orbs on the beat
  ['Кольцо', '{.0.v}'],
  ['Два кольца', '{.0.0.v} -'],
  ['Три кольца', '{.0.0.0.v}'],
  ['Пять колец', '{.0.0.0.0.0.v} -'],
  ['Семь колец', '{.0.0.0.0.0.0.0.v}'],
  ['Кольцо и шип', '{.0.v} S -'],
  ['Шип и кольцо', 'S {.0.v} -'],
  ['Кольцо и пропасть', '{.0.v} P -'],
  ['Кольца на ступеньку', '{.0.0.^} -'],
  ['Кольцо вниз', '{.0._} _'],
  ['Волна', '{.0.4.0.4.v}'],
  ['Подъём по кольцам', '{.0.2.4.6.v}'],
  ['Спуск по кольцам', '{.0.6.4.2.v}'],
  ['Высокое кольцо', '{.0.8.v} -'],
  ['Высокий-низкий', '{.0.8.0.v}'],
  ['Большая волна', '{.0.8.0.8.0.v}'],
  ['Кольцо вверх', '{.0.4.^} -'],
  ['Перекат', '{.0.v} {.0.v}'],
  ['Ступени к кольцу', 'U U {.0.v}'],
  ['Шип и кольца', 'S {.0.0.v}'],
  ['Ступенчатая волна', 'U {.0.v} W _'],
  ['Трамплин и кольцо', '[.g.v]'],
  ['Трамплин и два кольца', '[.g.c.v]'],
  ['Кольцо с трамплина', '<.8.v> -'],
  ['Трамплин и шипы', '<..v> _ S S'],
  ['Кольца над бездной', '{.0.0.0.0.v} - - -'],

  // ---------------------------------------------------------------- fast (every half beat)
  ['Двойной прыжок', '{4.v} _'],
  ['Розовое кольцо', '{4..v}'],
  ['Быстрая пара', '{44v} _'],
  ['Трель', '{444v}'],
  ['Длинная трель', '{44444v} -'],
  ['Очень длинная трель', '{4444444v}'],
  ['Зигзаг', '{4242v}'],
  ['Длинный зигзаг', '{4242424v}'],
  ['Лестница из колец', '{4567.v}'],
  ['Спуск из колец', '{4321v}'],
  ['Качели', '{4.4.4.v}'],
  ['Розовая лестница', '{4.6.8.v}'],
  ['Трель и кольцо', '{444.0.v}'],
  ['Смешанная цепь', '{.0.044.v}'],
  ['Пинг-понг', '{4.4..v}'],
  ['Двойка-двойка', '{4.v} _ {4.v} _'],
  ['Отбой', '_ {444v} _ -'],
  ['Тройки', '{44v} _ {44v} _'],
  ['Падение с трелью', '{444._}'],
  ['Пропасть и розовое', 'P {4..v} -'],
  ['Шип и трель', 'S {444v} -'],
  ['Ступенька и двойной', 'U {4.v} _'],
  ['Кольцо и зигзаг', '{.0.v} {4242v}'],
  ['Горка', 'U U {4..v} W _ W _'],
  ['Розовая волна', '{4.2.4.2.v}'],
  ['Звонок', '{4444.0.0.v}'],
  ['Лесенка-трель', '{4567.v} {4321v}'],

  // ---------------------------------------------------------------- spiked ceilings
  ['Под потолком', 'S c S -'],
  ['Не прыгай', 'c c S -'],
  ['Потолок и пропасть', 'P c P c'],
  ['Ловушка для торопыги', 'S c c S'],
  ['Тоннель с выходом', 'c c c P'],
  ['Потолок после кольца', '{.0.v} c -'],
  ['Потолок и трель', 'c {444v}'],
  ['Потолок и ступень', 'c U c W _'],
];

export const PATTERNS: Pattern[] = LIBRARY.map(([name, src, tier]) => parsePattern(name, src, tier));

/** The pattern used on drops (a big launch pad). */
export const DROP_PATTERN = PATTERNS.find((p) => p.name === 'Трамплин')!;
/** Used when the music is silent. */
export const REST_PATTERN = PATTERNS.find((p) => p.name === 'Короткая пробежка')!;
