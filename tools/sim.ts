// Level checker: builds every mode × difficulty for a set of songs and lets a perfect
// bot play them (it presses exactly on the cues, like ?autoplay). Any MISS or death means
// the generator produced something that cannot be passed. Also prints clicks-per-second stats.
//
//   node tools/sim.ts                     synthetic songs (different tempos and moods)
//   node tools/sim.ts song.pcm …          raw mono 16-bit PCM at 22050 Hz (dumped from the browser)
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

/** Plays the chart like the autoplay bot; returns how many mistakes happened. */
function autoplay(chart: Chart) {
  const run = new Run(chart, -1);
  const cues = chart.cues;
  let ci = 0;
  let misses = 0;
  let death = -1;
  for (let t = -1; t < chart.duration + 0.5; t += 1 / 60) {
    const presses: number[] = [];
    while (ci < cues.length && cues[ci].t <= t) presses.push(cues[ci++].t);
    run.update(t, presses);
    for (const e of run.events) {
      if (e.type === 'miss') misses++;
      if (e.type === 'death') death = run.t;
    }
    run.events.length = 0;
    if (run.dead) break;
  }
  return { misses, death, judged: run.scorer.counts };
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
  return bad;
}

const files = process.argv.slice(2);
let bad = 0;
if (files.length) {
  for (const f of files) bad += await check(f.split(/[\\/]/).pop()!, await analyze(bufferOf(loadPcm(f), SR)));
} else {
  for (const [bpm, seed] of [[84, 1], [100, 2], [120, 3], [138, 4], [160, 5], [174, 6]]) {
    bad += await check(`synth ${bpm}`, await analyze(bufferOf(synthSong(bpm, seed), SR)));
  }
}
console.log(bad ? `\n${bad} level(s) FAILED` : '\nall levels passed');
process.exit(bad ? 1 : 0);
