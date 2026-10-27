// The conductor: walks through the parts of the song (intro, verse, chorus…) and fills each
// one with patterns from the library. A pattern never runs over the end of a part, so the
// gameplay changes exactly when the music changes. Inside a part every pattern is scored:
//   - density: its clicks per second should match how intense the music is right there;
//   - rhythm: its presses should fall on the hits of the music;
//   - style: each part of the song has a favourite kind of patterns;
//   - variety: patterns that were used recently are avoided.
// A chorus that comes back replays the patterns it had the first time.
import type { Analysis } from '../../audio/analyze.ts';
import type { Section } from '../../audio/structure.ts';
import { CONFIG } from '../../config.ts';
import { STEP } from '../geometry.ts';
import type { Chart, Difficulty, Mode } from '../types.ts';
import { ChartBuilder } from './ChartBuilder.ts';
import { DROP_PATTERN, PATTERNS, REST_PATTERN, placePattern, type Family, type Pattern } from './patterns.ts';

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const C = CONFIG.conductor;
/** Two bars, in beats. */
const PHRASE = 8;

/** Favourite kinds of patterns, from calm to wild. */
const STYLES: Family[][] = [
  ['ground', 'rest'],
  ['ground', 'steps'],
  ['steps', 'orbs'],
  ['ground', 'ceil'],
  ['orbs', 'pad'],
  ['orbs', 'fast'],
  ['fast', 'ground'],
  ['fast', 'ceil'],
];

/** How loud and busy the music is around a beat, 0..1 (a beat that asks for a press). */
function beatAccent(an: Analysis, i: number) {
  if (i < 0 || i >= an.beats.length) return 0;
  return Math.min(1, 0.5 * an.onset[i] + 0.35 * an.kick[i] + 0.25 * an.energy[i]);
}

/** The accent of grid step k of a pattern that starts on beat i. */
function stepAccent(b: ChartBuilder, i: number, k: number) {
  if (b.airBeats === 2) return beatAccent(b.an, i + k);
  const j = i + (k >> 1);
  return k % 2 ? 0.9 * (b.an.offbeat[j] ?? 0) : beatAccent(b.an, j);
}

/** Mean loudness of beats [i, j). */
function loudness(an: Analysis, i: number, j: number) {
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, i); k < Math.min(j, an.energy.length); k++, n++) s += an.energy[k];
  return n ? s / n : 0;
}

interface Picked {
  pattern: Pattern;
  /** Beat offset from the start of its section. */
  offset: number;
}

/** Builds the level for a song. Same inputs always give the same level. */
export function buildChart(an: Analysis, diff: Difficulty, seed: number, mode: Mode = 'flow'): Chart {
  const P = CONFIG.levels[mode][diff];
  const b = new ChartBuilder(an, mode, P, seed + diff * 7919 + (mode === 'hardcore' ? 104729 : 0));
  const beats = an.beats;
  const n = beats.length;
  const bpu = b.airBeats; // beats per grid unit (one jump)
  const firstT = CONFIG.timing.firstObstacle[mode];
  const allowed = PATTERNS.filter(
    (p) => p.tier <= P.maxTier && (P.offbeat || !p.offbeat || bpu === 2) && p.chain <= P.chainMax && (P.ceilings || !p.ceilings),
  );
  const sections: Section[] = an.sections?.length ? an.sections : [{ start: 0, end: n, energy: 0.5, intensity: 0.5, busy: 0.3, label: 0, drop: false }];
  const recent: Pattern[] = [];
  const byLabel = new Map<number, Picked[]>();
  let prevLabel = -1;

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    // the first section starts on the first full bar
    let i = si === 0 ? Math.max(sec.start, an.barPhase ?? 0) : sec.start;
    const end = Math.min(sec.end, n - 2 * bpu);
    if (i >= end) continue;
    const t0 = beats[i];
    const mul = P.portals ? portalSpeed(sec.intensity) : 1;
    b.setSpeed(Math.max(t0, b.readyT), mul);
    b.sections.push({ t: t0, x: b.X(t0), intensity: sec.intensity, label: sec.label, drop: sec.drop });

    // favourite patterns of this part: parts that sound alike get the same style
    const styleIdx = Math.min(STYLES.length - 1, Math.floor(sec.intensity * 5.5 + ((sec.label * 7 + seed) % 3)));
    const style = STYLES[styleIdx];
    const k = Math.max(0, Math.min(1, (sec.intensity - 0.15) / 0.8));
    const sectionCps = P.cps[0] + (P.cps[1] - P.cps[0]) * Math.pow(k, 1.3);

    // a chorus that comes back replays its patterns (the first 8 bars of them)
    const replay = sec.label !== prevLabel ? byLabel.get(sec.label) : undefined;
    const picked: Picked[] = [];
    let ri = 0;
    /** Patterns of the previous 2 bars, played again as an answer to them. */
    let echo: Picked[] = [];
    let ei = 0;

    while (i < end) {
      const t = Math.max(beats[i], b.readyT + 0.01);
      const left = end - i;
      const offset = i - sec.start;
      let p: Pattern | null = null;
      // musical phrases are 4 bars long; their second half often repeats the first one
      if (offset > 0 && offset % (2 * PHRASE) === PHRASE && b.rand() < C.phraseRepeat) {
        echo = picked.filter((pk) => pk.offset >= offset - PHRASE && pk.offset < offset).map((pk) => ({ ...pk, offset: pk.offset + PHRASE }));
        ei = 0;
      }
      while (replay && ri < replay.length && replay[ri].offset < offset) ri++;
      while (ei < echo.length && echo[ei].offset < offset) ei++;

      if (t < firstT || loudness(an, i, i + 2 * bpu) < C.silence) {
        p = REST_PATTERN;
      } else if (i === sec.start && sec.drop && left >= DROP_PATTERN.steps * bpu / 2 && b.drops.every((d) => t - d > 8 * b.beatDur)) {
        p = DROP_PATTERN;
        b.drops.push(t);
      } else if (replay && ri < replay.length && replay[ri].offset === offset && fits(b, replay[ri].pattern, left, P.maxSteps)) {
        p = replay[ri++].pattern;
      } else if (ei < echo.length && echo[ei].offset === offset && fits(b, echo[ei].pattern, left, P.maxSteps)) {
        p = echo[ei++].pattern;
      } else {
        const local = loudness(an, i, i + 4 * bpu) - sec.energy;
        const target = Math.max(0.05, sectionCps * (1 + 1.2 * local));
        p = choose(b, allowed, i, left, target, style, recent);
      }
      if (!p) p = REST_PATTERN;
      if (p.steps * bpu / 2 > left) break;

      placePattern(b, p, t);
      b.readyT = t + p.steps * b.half;
      // a short breather after every pattern on the easiest level
      if (P.rest && p.clicks.length) b.readyT += P.rest * b.half;
      b.patterns.push({ t, name: p.name });
      picked.push({ pattern: p, offset: i - sec.start });
      if (p.clicks.length) {
        recent.push(p);
        if (recent.length > 8) recent.shift();
      }
      // next free beat on the grid
      const used = (b.readyT - t) / b.half;
      i += Math.ceil(used / 2 - 0.05) * bpu;
      while (i < end && beats[i] < b.readyT - 0.03) i += bpu;
    }
    if (!byLabel.has(sec.label)) byLabel.set(sec.label, picked.filter((pk) => pk.offset < 32));
    prevLabel = sec.label;
  }
  return b.build();
}

/** Speed of a part by how intense it is (speed portals). */
function portalSpeed(intensity: number) {
  const s = C.portalSpeeds;
  return intensity < 0.35 ? s[0] : intensity < 0.7 ? s[1] : intensity < 0.9 ? s[2] : s[3];
}

/** Does the pattern fit in the time left and in the height limits? */
function fits(b: ChartBuilder, p: Pattern, leftBeats: number, maxSteps: number) {
  const level = Math.round(b.curY / STEP);
  return (p.steps * b.airBeats) / 2 <= leftBeats && level + p.minY >= 0 && level + p.maxY <= maxSteps;
}

function choose(b: ChartBuilder, list: Pattern[], i: number, leftBeats: number, target: number, style: Family[], recent: Pattern[]) {
  let best: Pattern | null = null;
  let bestScore = -Infinity;
  const level = Math.round(b.curY / STEP);
  for (const p of list) {
    if (!fits(b, p, leftBeats, b.P.maxSteps)) continue;
    const sec = p.steps * b.half;
    const cps = p.clicks.length / sec;
    // 1. density (log scale: 1 vs 2 cps is as different as 2 vs 4)
    let score = -C.densityWeight * Math.abs(Math.log((cps + 0.2) / (target + 0.2)));
    // 2. rhythm: presses on the hits of the music, none on silence between the beats
    if (p.clicks.length) {
      let all = 0;
      for (let k = 0; k < p.steps; k++) all += stepAccent(b, i, k);
      all /= p.steps;
      let hit = 0;
      for (const k of p.clicks) {
        const a = stepAccent(b, i, k);
        hit += a;
        if (k % 2 && b.airBeats === 1 && a < 0.3) score -= 0.5;
      }
      score += C.musicWeight * (hit / p.clicks.length - all) * 2;
    }
    // 3. style of this part of the song
    if (p.families.some((f) => style.includes(f))) score += C.styleBonus;
    // 4. variety
    const uses = recent.filter((r) => r === p).length;
    score -= C.repeatPenalty * uses;
    if (recent[recent.length - 1] === p) score -= C.repeatPenalty;
    // 5. come back down when high up, climb when low
    if (level >= b.P.maxSteps - 1 && p.netY < 0) score += 0.3;
    if (level === 0 && p.netY > 0) score += 0.1;
    score += b.rand() * C.randomness;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
