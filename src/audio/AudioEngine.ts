// Playback, the song clock, volume, a live spectrum for visuals and sound effects.
//
// Audio graph:
//   song ─► music(gain, fades) ─► filter(muffle) ─► musicVol ─┐
//                    └─► analyser (visuals)                    ├─► master ─► speakers
//   sfx (Synth) ─────────────────────────────────► sfxVol ───┘
import { CONFIG } from '../config.ts';
import { storage } from '../data/storage.ts';
import { SOUNDS, Synth, type SoundName } from './sfx.ts';

/** Live loudness of the music, for visuals. */
export interface Levels {
  bass: number;
  mid: number;
  high: number;
  /** 48 log-spaced bands, 0..1 */
  bands: Float32Array;
}

export type VolumeKind = 'master' | 'music' | 'sfx';

export class AudioEngine {
  ctx: AudioContext | null = null;
  muted = storage.get<boolean | number>('muted', false) ? true : false;
  /** 0..1 each, saved in the browser. */
  volume: Record<VolumeKind, number> = { ...CONFIG.audio.defaultVolume, ...storage.get<Partial<Record<VolumeKind, number>>>('volume', {}) };
  readonly levels: Levels = { bass: 0, mid: 0, high: 0, bands: new Float32Array(48) };

  private master!: GainNode;
  private music!: GainNode;
  private filter!: BiquadFilterNode;
  private musicVol!: GainNode;
  private sfxVol!: GainNode;
  private analyser!: AnalyserNode;
  private synth!: Synth;
  private readonly freq = new Uint8Array(512);
  private source: AudioBufferSourceNode | null = null;
  /** Context time at which song time 0 is played. */
  private startAt = 0;

  /** Must be called from a user gesture (click, key) before anything can be heard. */
  unlock() {
    if (!this.ctx) this.createGraph();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  }

  private createGraph() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new AC({ latencyHint: 'interactive' });
    this.ctx = c;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.8;
    this.music = c.createGain();
    this.musicVol = c.createGain();
    this.music.connect(this.filter).connect(this.musicVol).connect(this.master);
    // the analyser listens before the volume knob, so visuals keep dancing at any volume
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.music.connect(this.analyser);
    this.sfxVol = c.createGain();
    this.sfxVol.connect(this.master);
    this.synth = new Synth(c, this.sfxVol);
    this.applyVolume(true);
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    this.unlock();
    return await this.ctx!.decodeAudioData(data);
  }

  // ---------------------------------------------------------------- volume

  toggleMute() {
    this.muted = !this.muted;
    storage.set('muted', this.muted);
    this.applyVolume();
  }

  setVolume(kind: VolumeKind, v: number) {
    this.volume[kind] = Math.max(0, Math.min(1, v));
    if (kind === 'master' && v > 0 && this.muted) this.muted = false;
    storage.set('volume', this.volume);
    storage.set('muted', this.muted);
    this.applyVolume();
  }

  private applyVolume(instant = false) {
    const c = this.ctx;
    if (!c) return;
    // squared curve feels more natural to the ear than a linear one
    const curve = (v: number) => v * v;
    const set = (p: AudioParam, v: number) => (instant ? (p.value = v) : p.setTargetAtTime(v, c.currentTime, 0.03));
    set(this.master.gain, this.muted ? 0 : curve(this.volume.master));
    set(this.musicVol.gain, curve(this.volume.music));
    set(this.sfxVol.gain, CONFIG.audio.sfxLevel * curve(this.volume.sfx));
  }

  // ---------------------------------------------------------------- song

  /** Start the song so that song time 0 happens after `lead` seconds. */
  play(buffer: AudioBuffer, lead = 2) {
    this.unlock();
    this.stop();
    const c = this.ctx!;
    if (c.state === 'suspended') void c.resume();
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(this.music);
    this.startAt = c.currentTime + lead;
    src.start(this.startAt);
    this.source = src;
    this.filter.frequency.cancelScheduledValues(c.currentTime);
    this.filter.frequency.setValueAtTime(20000, c.currentTime);
    this.music.gain.cancelScheduledValues(c.currentTime);
    this.music.gain.setValueAtTime(1, c.currentTime);
  }

  stop() {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      /* already stopped */
    }
    this.source.disconnect();
    this.source = null;
  }

  /** Current position in the song as the player hears it (negative during the count-in). */
  songTime() {
    const c = this.ctx;
    if (!c) return 0;
    const lat = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0;
    return c.currentTime - this.startAt - lat;
  }

  /** Freezes everything, including the song clock. */
  pause() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Muffle the music for a moment (used on mistakes). */
  muffle() {
    const c = this.ctx;
    if (!c) return;
    const f = this.filter.frequency;
    f.cancelScheduledValues(c.currentTime);
    f.setValueAtTime(f.value, c.currentTime);
    f.exponentialRampToValueAtTime(500, c.currentTime + 0.05);
    f.exponentialRampToValueAtTime(20000, c.currentTime + 0.9);
  }

  fadeOut(sec: number) {
    const c = this.ctx;
    if (!c) return;
    this.music.gain.setTargetAtTime(0, c.currentTime, sec / 3);
  }

  // ---------------------------------------------------------------- analysis & sfx

  /** Live spectrum of what is playing now. */
  readLevels(): Levels {
    const L = this.levels;
    if (!this.ctx) return L;
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (a: number, b: number) => {
      const i0 = Math.max(1, Math.floor(a / binHz));
      const i1 = Math.max(i0 + 1, Math.floor(b / binHz));
      let s = 0;
      for (let i = i0; i < i1; i++) s += f[i];
      return s / (i1 - i0) / 255;
    };
    L.bass = avg(30, 140);
    L.mid = avg(300, 2000);
    L.high = avg(4000, 12000);
    const n = L.bands.length;
    for (let i = 0; i < n; i++) {
      const a = 40 * Math.pow(16000 / 40, i / n);
      const b = 40 * Math.pow(16000 / 40, (i + 1) / n);
      L.bands[i] = avg(a, b);
    }
    return L;
  }

  sound(name: SoundName) {
    if (this.ctx) SOUNDS[name](this.synth);
  }
}
