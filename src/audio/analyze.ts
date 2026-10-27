// Offline music analysis: onset envelope -> tempo -> beat tracking -> per-beat features.
import { fft } from './fft.ts';
import { findBarPhase, findSections, type Section } from './structure.ts';

export interface Analysis {
  duration: number;
  bpm: number;
  /** Median beat length in seconds. */
  beatDur: number;
  /** Beat times in seconds. */
  beats: number[];
  /** Per-beat features, all normalised to 0..1. */
  onset: number[];
  kick: number[];
  offbeat: number[];
  energy: number[];
  /** Loudness of the bass, the middle and the highs on each beat, 0..1. */
  low: number[];
  mid: number[];
  high: number[];
  /** Energy smoothed over ~2 bars. */
  smooth: number[];
  /** Which beat (0..3) starts the bars. */
  barPhase: number;
  /** Parts of the song (intro, verse, chorus…), in order, covering all beats. */
  sections: Section[];
  /** Coarse loudness curve for the progress bar. */
  overview: number[];
}

const N = 1024;
const HOP = 256;

function percentile(arr: ArrayLike<number>, p: number) {
  const a = Array.from(arr).sort((x, y) => x - y);
  if (!a.length) return 1;
  return a[Math.min(a.length - 1, Math.floor(a.length * p))] || 1;
}

function normalise(arr: number[], p = 0.95) {
  const top = percentile(arr, p) || 1;
  return arr.map((v) => Math.min(1, v / top));
}

// Yield to the browser without setTimeout (which is throttled in background tabs).
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const pending: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => pending.shift()?.();
const tick = () =>
  new Promise<void>((r) => {
    if (!channel) return void setTimeout(r, 0);
    pending.push(r);
    channel.port2.postMessage(0);
  });

export async function analyze(buf: AudioBuffer, progress?: (p: number) => void): Promise<Analysis> {
  const sr0 = buf.sampleRate;
  const dec = sr0 > 32000 ? 2 : 1;
  const sr = sr0 / dec;
  const len = Math.floor(buf.length / dec);
  const mono = new Float32Array(len);
  const chans = buf.numberOfChannels;
  for (let c = 0; c < chans; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let k = 0; k < dec; k++) s += d[i * dec + k];
      mono[i] += s / (dec * chans);
    }
  }

  const frames = Math.max(8, Math.floor((len - N) / HOP));
  const fps = sr / HOP;
  const timeOf = (f: number) => (f * HOP + N / 2) / sr;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const binHz = sr / N;
  const lowEnd = Math.max(2, Math.round(150 / binHz));
  const highEnd = Math.min(N / 2 - 1, Math.round(9000 / binHz));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const prev = new Float32Array(N / 2);
  const flux = new Float32Array(frames);
  const lowFlux = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const bandLow = new Float32Array(frames);
  const bandMid = new Float32Array(frames);
  const bandHigh = new Float32Array(frames);
  const midEnd = Math.round(2000 / binHz);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const s = mono[off + i] ?? 0;
      e += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    let fl = 0;
    let lo = 0;
    let bl = 0;
    let bm = 0;
    let bh = 0;
    for (let k = 1; k <= highEnd; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (k < lowEnd) bl += mag;
      else if (k < midEnd) bm += mag;
      else bh += mag;
      const m = Math.log1p(100 * mag);
      const d = m - prev[k];
      prev[k] = m;
      if (d > 0) {
        fl += d;
        if (k < lowEnd) lo += d * 4;
      }
    }
    bandLow[f] = bl;
    bandMid[f] = bm;
    bandHigh[f] = bh;
    flux[f] = fl;
    lowFlux[f] = lo;
    if (f % 600 === 0) {
      progress?.((f / frames) * 0.75);
      await tick();
    }
  }

  // Remove the slowly varying part so only the attacks remain.
  const detrend = (src: Float32Array) => {
    const w = Math.round(fps * 0.3);
    const pre = new Float64Array(frames + 1);
    for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + src[i];
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const a = Math.max(0, i - w);
      const b = Math.min(frames, i + w + 1);
      out[i] = Math.max(0, src[i] - (pre[b] - pre[a]) / (b - a));
    }
    return out;
  };
  const od = detrend(flux);
  const lod = detrend(lowFlux);
  progress?.(0.8);
  await tick();

  // ---- tempo by autocorrelation, with a preference for ~120 BPM.
  // A real beat period repeats at 2, 3 and 4 periods too, while a wrong 3:2 guess
  // (a common trap with syncopated music) only lines up every other time.
  const minLag = Math.floor((60 * fps) / 200);
  const maxLag = Math.ceil((60 * fps) / 60);
  let bestLag = minLag;
  let bestScore = -1;
  const acf = new Float32Array(4 * maxLag + 6);
  for (let lag = minLag; lag < acf.length; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += od[i] * od[i + lag];
    acf[lag] = s / Math.max(1, frames - lag);
  }
  /** Autocorrelation at a fractional lag (best of the neighbours, beats are never perfectly even). */
  const acfAt = (l: number) => {
    const i = Math.round(l);
    return Math.max(acf[i - 1] ?? 0, acf[i] ?? 0, acf[i + 1] ?? 0);
  };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const comb = acf[lag] + 0.5 * acfAt(2 * lag) + 0.33 * acfAt(3 * lag) + 0.25 * acfAt(4 * lag);
    const sc = comb * w;
    if (sc > bestScore) {
      bestScore = sc;
      bestLag = lag;
    }
  }
  const a = acf[bestLag - 1] ?? 0;
  const b = acf[bestLag];
  const c = acf[bestLag + 1] ?? 0;
  const denom = a - 2 * b + c;
  const lagF = bestLag + (denom !== 0 ? (0.5 * (a - c)) / denom : 0);
  let bpm = (60 * fps) / lagF;
  while (bpm < 78) bpm *= 2;
  while (bpm > 165) bpm /= 2;
  const period = (60 * fps) / bpm;

  // ---- dynamic-programming beat tracker (Ellis 2007): follows the music, stays steady
  let sd = 0;
  for (let i = 0; i < frames; i++) sd += od[i] * od[i];
  sd = Math.sqrt(sd / frames) || 1;
  const score = new Float32Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const tight = 300;
  const lo = Math.round(period * 0.5);
  const hi = Math.round(period * 2);
  for (let t = 0; t < frames; t++) {
    let best = 0;
    let arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const r = Math.log((t - tau) / period);
      const v = score[tau] - tight * r * r;
      if (v > best || arg < 0) {
        best = v;
        arg = tau;
      }
    }
    score[t] = od[t] / sd + Math.max(0, best);
    back[t] = best > 0 ? arg : -1;
    if (t % 4000 === 0) await tick();
  }
  let end = frames - 1;
  let endBest = -Infinity;
  for (let t = Math.max(0, frames - Math.round(period)); t < frames; t++) {
    if (score[t] > endBest) {
      endBest = score[t];
      end = t;
    }
  }
  const beatFrames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beatFrames.push(t);
    if (back[t] < 0) break;
  }
  beatFrames.reverse();
  let beats = beatFrames.map(timeOf);
  const intervals = beats.slice(1).map((t, i) => t - beats[i]).sort((x, y) => x - y);
  const beatDur = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 60 / bpm;
  // extend the grid to the start of the song if the tracker locked on late
  while (beats.length && beats[0] - beatDur > 0.05) beats.unshift(beats[0] - beatDur);
  const duration = buf.duration;
  while (beats.length && beats[beats.length - 1] + beatDur < duration - 0.05) beats.push(beats[beats.length - 1] + beatDur);
  beats = beats.filter((t) => t >= 0 && t < duration);
  progress?.(0.92);
  await tick();

  // ---- per-beat features
  const frameAt = (t: number) => Math.round((t * sr - N / 2) / HOP);
  const peak = (src: Float32Array, t: number, w = 3) => {
    const f = frameAt(t);
    let m = 0;
    for (let i = f - w; i <= f + w; i++) if (i >= 0 && i < frames) m = Math.max(m, src[i]);
    return m;
  };
  const onset: number[] = [];
  const kick: number[] = [];
  const offbeat: number[] = [];
  const energy: number[] = [];
  const low: number[] = [];
  const mid: number[] = [];
  const high: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const t = beats[i];
    const next = beats[i + 1] ?? t + beatDur;
    onset.push(peak(od, t));
    kick.push(peak(lod, t));
    offbeat.push(peak(od, (t + next) / 2));
    const f0 = Math.max(0, Math.min(frames - 1, frameAt(t)));
    const f1 = Math.min(frames, Math.max(f0 + 1, frameAt(next)));
    let e = 0;
    let bl = 0;
    let bm = 0;
    let bh = 0;
    for (let f = f0; f < f1; f++) {
      e += rms[f];
      bl += bandLow[f];
      bm += bandMid[f];
      bh += bandHigh[f];
    }
    energy.push(e / (f1 - f0));
    low.push(bl / (f1 - f0));
    mid.push(bm / (f1 - f0));
    high.push(bh / (f1 - f0));
  }
  const energyN = normalise(energy, 0.97);
  const smooth = energyN.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = i - 4; k <= i + 4; k++) {
      if (k >= 0 && k < energyN.length) {
        s += energyN[k];
        n++;
      }
    }
    return s / n;
  });
  const overview: number[] = [];
  const bins = 300;
  for (let i = 0; i < bins; i++) {
    const f0 = Math.floor((i / bins) * frames);
    const f1 = Math.max(f0 + 1, Math.floor(((i + 1) / bins) * frames));
    let m = 0;
    for (let f = f0; f < f1; f++) m = Math.max(m, rms[f]);
    overview.push(m);
  }
  progress?.(1);
  const features = {
    onset: normalise(onset),
    kick: normalise(kick),
    offbeat: normalise(offbeat),
    energy: energyN,
    low: normalise(low, 0.97),
    mid: normalise(mid, 0.97),
    high: normalise(high, 0.97),
  };
  const barPhase = findBarPhase(features);
  return {
    duration,
    bpm: 60 / beatDur,
    beatDur,
    beats,
    ...features,
    smooth,
    barPhase,
    sections: findSections(features, barPhase),
    overview: normalise(overview, 0.99),
  };
}
