// Playback, the song clock, a live spectrum for visuals and small synthesized SFX.

export interface Levels {
  bass: number;
  mid: number;
  high: number;
  /** 48 log-spaced bands, 0..1 */
  bands: Float32Array;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private filter!: BiquadFilterNode;
  private analyser!: AnalyserNode;
  private sfx!: GainNode;
  private musicVol!: GainNode;
  private noise!: AudioBuffer;
  private freq = new Uint8Array(512);
  private source: AudioBufferSourceNode | null = null;
  private startAt = 0;
  muted = false;
  sfxOn = true;
  /** 0..1 each, saved in the browser. */
  volume = { master: 0.9, music: 1, sfx: 0.8 };
  readonly levels: Levels = { bass: 0, mid: 0, high: 0, bands: new Float32Array(48) };

  constructor() {
    try {
      this.muted = localStorage.getItem('pryg-muted') === '1';
      const v = JSON.parse(localStorage.getItem('pryg-volume') ?? 'null') as Partial<AudioEngine['volume']> | null;
      if (v) this.volume = { ...this.volume, ...v };
    } catch {
      /* storage unavailable */
    }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume.master ** 2;
      this.master.connect(c.destination);
      this.filter = c.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.8;
      this.music = c.createGain();
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.55;
      this.musicVol = c.createGain();
      this.musicVol.gain.value = this.volume.music ** 2;
      this.music.connect(this.filter).connect(this.musicVol).connect(this.master);
      // the analyser listens before the volume knob, so visuals keep dancing at any volume
      this.music.connect(this.analyser);
      this.sfx = c.createGain();
      this.sfx.gain.value = 0.5 * this.volume.sfx ** 2;
      this.sfx.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    this.unlock();
    return await this.ctx!.decodeAudioData(data);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('pryg-muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.applyVolume();
  }

  setVolume(kind: keyof AudioEngine['volume'], v: number) {
    this.volume[kind] = Math.max(0, Math.min(1, v));
    if (kind === 'master' && v > 0 && this.muted) this.muted = false;
    try {
      localStorage.setItem('pryg-volume', JSON.stringify(this.volume));
      localStorage.setItem('pryg-muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.applyVolume();
  }

  private applyVolume() {
    const c = this.ctx;
    if (!c) return;
    // squared curve feels more natural to the ear than a linear one
    const curve = (v: number) => v * v;
    this.master.gain.setTargetAtTime(this.muted ? 0 : curve(this.volume.master), c.currentTime, 0.03);
    this.musicVol.gain.setTargetAtTime(curve(this.volume.music), c.currentTime, 0.03);
    this.sfx.gain.setTargetAtTime(0.5 * curve(this.volume.sfx), c.currentTime, 0.03);
  }

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
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Current position in the song as the player hears it. */
  songTime() {
    const c = this.ctx;
    if (!c) return 0;
    const lat = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0;
    return c.currentTime - this.startAt - lat;
  }

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

  readLevels() {
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

  // ---------------------------------------------------------------- sfx

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, to?: number) {
    const c = this.ctx;
    if (!c || !this.sfxOn) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number) {
    const c = this.ctx;
    if (!c || !this.sfxOn) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  sound(name: string) {
    switch (name) {
      case 'PERFECT':
        this.tone(1760, 0.06, 'sine', 0.12);
        break;
      case 'GREAT':
        this.tone(1320, 0.05, 'sine', 0.08);
        break;
      case 'note':
        this.tone(2093, 0.05, 'triangle', 0.05);
        break;
      case 'miss':
        this.hiss(0.25, 0.35, 700);
        this.tone(220, 0.25, 'sawtooth', 0.06, 70);
        break;
      case 'pad':
        this.tone(300, 0.4, 'sine', 0.15, 1200);
        break;
      case 'click':
        this.tone(900, 0.04, 'triangle', 0.08);
        break;
    }
  }
}
