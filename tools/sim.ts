// Level checker: builds every mode × difficulty for a set of songs and lets a perfect
// bot play them (it presses exactly on the cues, like ?autoplay). Any MISS or death means
// the generator produced something that cannot be passed. Also prints clicks-per-second stats.
//
//   node tools/sim.ts                     synthetic songs (different tempos and moods)
//   node tools/sim.ts song.pcm …          raw mono 16-bit PCM at 22050 Hz (dumped from the browser)
//   node tools/sim.ts --human [files]     also lets a human-like bot (presses off by ±25 ms) play
//                                         and lists the patterns where it fails most often
//
// Runs on plain Node (22.18+ / 24), no build step: the rhythm code does not touch the DOM.
import { readFileSync } from 'node:fs';
import { analyze, type Analysis } from '../src/audio/analyze.ts';
import { buildChart } from '../src/rhythm/generator/buildChart.ts';
import { Run } from '../src/rhythm/Run.ts';
import type { Chart, Difficulty, Mode } from '../src/rhythm/types.ts';
import { chartStats } from '../src/rhythm/stats.ts';

const SR = 22050;

/** A fake AudioBuffer over mono samples. */
function bufferOf(mono: Float32Array, sr: number) {
  return {
    sampleRate: sr,
    length: mono.length,
    duration: mono.length / sr,
    numberOfChannels: 1,
    getChannelData: () => mono,
  } as unknown as AudioBuffer;
}

function loadPcm(path: string) {
  const raw = readFileSync(path);
  const i16 = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}

/** A drum-machine song: kick, snare, hats, with a quiet intro, verses, choruses and a break. */
function synthSong(bpm: number, seed: number, seconds = 120) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const out = new Float32Array(Math.floor(seconds * SR));
  const beat = 60 / bpm;
  const add = (t: number, len: number, fn: (u: number) => number) => {
    const i0 = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    for (let k = 0; k < n && i0 + k < out.length; k++) out[i0 + k] += fn(k / SR);
  };
  for (let b = 0, t = 0.3; t < seconds - 1; b++, t += beat) {
    const bar = Math.floor(b / 4);
    const part = Math.floor(bar / 8) % 4; // 0 intro, 1 verse, 2 chorus, 3 break
    const loud = [0.25, 0.6, 1, 0.4][part];
    if (part !== 3 || b % 2 === 0) add(t, 0.25, (u) => loud * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-u * 30)) * u) * Math.exp(-u * 12));
    if (b % 2 === 1 && part > 0) add(t, 0.18, (u) => loud * 0.5 * (rand() * 2 - 1) * Math.exp(-u * 20));
    const hats = part === 2 ? 4 : 2;
    for (let h = 0; h < hats; h++) add(t + (h * beat) / hats, 0.04, (u) => loud * 0.15 * (rand() * 2 - 1) * Math.exp(-u * 90));
    add(t, beat, (u) => loud * 0.08 * Math.sin(2 * Math.PI * (220 + 40 * part) * u));
  }
  return out;
}

const MODES: Mode[] = ['flow', 'hardcore'];

/** Normal noise with standard deviation sd. */
function gauss(rand: () => number, sd: number) {
  return sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

/** Plays the chart like the autoplay bot (or a human with timing error `sd`); returns the mistakes. */
function autoplay(chart: Chart, sd = 0, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const run = new Run(chart, -1);
  const times = chart.cues.map((c) => c.t + (sd ? gauss(rand, sd) : 0)).sort((a, b) => a - b);
  let ci = 0;
  let misses = 0;
  let death = -1;
  const missAt: number[] = [];
  for (let t = -1; t < chart.duration + 0.5; t += 1 / 60) {
    const presses: number[] = [];
    while (ci < times.length && times[ci] <= t) presses.push(times[ci++]);
    run.update(t, presses);
    for (const e of run.events) {
      if (e.type === 'miss') {
        misses++;
        missAt.push(run.t);
      }
      if (e.type === 'death') death = run.t;
    }
    run.events.length = 0;
    if (run.dead) break;
  }
  return { misses, death, missAt, judged: run.scorer.counts };
}

async function check(name: string, an: Analysis) {
  let bad = 0;
  console.log(`\n== ${name}: ${an.bpm.toFixed(1)} BPM, ${an.duration.toFixed(0)} s, ${an.beats.length} beats`);
  for (const mode of MODES) {
    for (const diff of [0, 1, 2] as Difficulty[]) {
      const chart = buildChart(an, diff, 12345, mode);
      const st = chartStats(chart);
      const res = autoplay(chart);
      const fail = res.misses > 0 || res.death >= 0;
      if (fail) bad++;
      const ok = fail ? `FAIL misses=${res.misses}${res.death >= 0 ? ` death@${res.death.toFixed(2)}s` : ''}` : 'ok';
      console.log(
        `  ${mode.padEnd(8)} ${diff}  clicks ${String(st.clicks).padStart(4)}  avg ${st.avgCps.toFixed(2)} cps  peak ${st.peakCps.toFixed(2)} cps  ` +
          `orbs ${String(chart.orbs.length).padStart(3)}  patterns ${String(st.patterns).padStart(3)} (${String(new Set(chart.patterns?.map((q) => q.name)).size).padStart(2)} kinds)  portals ${chart.speeds.length - 1}  ${ok}`,
      );
    }
  }
  if (HUMAN) human(an);
  return bad;
}

/** Fails of the human-like bot per pattern name: [fails, times the pattern was played]. */
const blame = new Map<string, [number, number]>();
const HUMAN_SD = Number(process.env.SD ?? 0.025);
const TRIES = 8;

/** A human-like bot plays each level a few times: how far does it get, which patterns kill it. */
function human(an: Analysis) {
  for (const mode of MODES) {
    for (const diff of [0, 1, 2] as Difficulty[]) {
      let reach = 0;
      let misses = 0;
      let passed = 0;
      for (let k = 0; k < TRIES; k++) {
        const chart = buildChart(an, diff, 12345, mode);
        const pats = chart.patterns ?? [];
        const res = autoplay(chart, HUMAN_SD, 1000 + k * 77);
        const fails = res.death >= 0 ? [res.death] : res.missAt;
        const end = res.death >= 0 ? res.death : chart.duration;
        reach += end / chart.duration;
        misses += res.missAt.length;
        if (res.death < 0 && !res.missAt.length) passed++;
        for (const p of pats) {
          if (p.t > end) break;
          const e = blame.get(p.name) ?? [0, 0];
          e[1]++;
          blame.set(p.name, e);
        }
        for (const ft of fails) {
          // the pattern that was playing when it went wrong
          let at = pats[0];
          for (const p of pats) if (p.t <= ft + 0.05) at = p;
          if (at) blame.get(at.name)![0]++;
        }
      }
      const r = mode === 'hardcore' ? `reach ${((reach / TRIES) * 100).toFixed(0)}%` : `misses ${(misses / TRIES).toFixed(1)}`;
      console.log(`    human ${mode.padEnd(8)} ${diff}  ${r}  clean ${passed}/${TRIES}`);
    }
  }
}

const HUMAN = process.argv.includes('--human');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let bad = 0;
if (files.length) {
  for (const f of files) bad += await check(f.split(/[\\/]/).pop()!, await analyze(bufferOf(loadPcm(f), SR)));
} else {
  for (const [bpm, seed] of [[84, 1], [100, 2], [120, 3], [138, 4], [160, 5], [174, 6]]) {
    bad += await check(`synth ${bpm}`, await analyze(bufferOf(synthSong(bpm, seed), SR)));
  }
}
if (HUMAN) {
  console.log('\nPatterns where the human-like bot fails most (fails / plays):');
  [...blame.entries()]
    .filter(([, [f]]) => f > 0)
    .sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1])
    .slice(0, 25)
    .forEach(([name, [f, n]]) => console.log(`  ${(f / n).toFixed(2)}  ${f}/${n}  ${name}`));
}
console.log(bad ? `\n${bad} level(s) FAILED` : '\nall levels passed');
process.exit(bad ? 1 : 0);
