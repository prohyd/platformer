// Tiny synthesizer: all sounds and music are generated with WebAudio, no files needed.
import type { Theme } from './themes.ts';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  private musicTheme: Theme['music'] | null = null;
  private boss = false;
  private nextNote = 0;
  private step = 0;
  private timer: number | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem('pryg-muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.55;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.22;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('pryg-muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, bus?: GainNode) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, delay = 0, q = 1, bus?: GainNode, at?: number) {
    const c = this.ctx;
    if (!c) return;
    const t = at ?? c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus ?? this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  play(name: string, v = 0) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'jump':
        this.tone(320, 0.14, 'square', 0.12, 640);
        break;
      case 'walljump':
        this.tone(380, 0.14, 'square', 0.12, 760);
        this.noise(0.06, 0.15, 2000);
        break;
      case 'orb':
        this.tone(520, 0.18, 'sine', 0.2, 1040);
        this.tone(780, 0.18, 'triangle', 0.1, 1560, 0.03);
        break;
      case 'land':
        this.noise(0.08, Math.min(0.25, v / 3000), 600);
        break;
      case 'spring':
        this.tone(200, 0.3, 'sine', 0.25, 900);
        this.tone(150, 0.2, 'square', 0.06, 500);
        break;
      case 'coin':
        this.tone(988, 0.08, 'square', 0.08);
        this.tone(1319, 0.2, 'square', 0.08, undefined, 0.07);
        break;
      case 'crumbleStart':
        this.noise(0.12, 0.12, 1800, 0, 3);
        break;
      case 'crumble':
        this.noise(0.25, 0.25, 400, 0, 0.8);
        break;
      case 'toggle':
        this.tone(v ? 660 : 440, 0.06, 'triangle', 0.08);
        break;
      case 'gravity':
        this.tone(v < 0 ? 300 : 900, 0.3, 'sine', 0.18, v < 0 ? 900 : 300);
        this.noise(0.3, 0.08, 3000);
        break;
      case 'checkpoint':
        [0, 4, 7, 12].forEach((n, i) => this.tone(midi(72 + n), 0.18, 'triangle', 0.14, undefined, i * 0.06));
        break;
      case 'death':
        this.noise(0.35, 0.35, 900, 0, 0.7);
        this.tone(400, 0.4, 'sawtooth', 0.1, 60);
        break;
      case 'win':
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(midi(67 + n), 0.3, 'square', 0.08, undefined, i * 0.08));
        break;
      case 'bonk':
        this.tone(160, 0.08, 'square', 0.08, 90);
        break;
      case 'doorClose':
        this.noise(0.5, 0.4, 200, 0, 0.5);
        this.tone(80, 0.5, 'sawtooth', 0.12, 50);
        break;
      case 'bossIntro':
        this.tone(55, 1.4, 'sawtooth', 0.2, 40);
        this.noise(1.2, 0.2, 150, 0, 0.5);
        break;
      case 'bossWindup':
        this.tone(200, 0.5, 'square', 0.08, 600);
        break;
      case 'bossSlam':
        this.noise(0.6, 0.5, 120, 0, 0.6);
        this.tone(70, 0.5, 'sine', 0.4, 30);
        break;
      case 'bossHit':
        this.tone(600, 0.25, 'square', 0.15, 150);
        this.noise(0.25, 0.3, 1000);
        break;
      case 'bossThrow':
        this.tone(300, 0.15, 'triangle', 0.1, 150);
        break;
      case 'bossBoom':
        this.noise(0.4, 0.3, 300, 0, 0.6);
        break;
      case 'bossDead':
        this.noise(1.5, 0.5, 200, 0, 0.4);
        [0, 3, 7, 12].forEach((n, i) => this.tone(midi(60 + n), 0.5, 'triangle', 0.12, undefined, 0.4 + i * 0.12));
        break;
      case 'click':
        this.tone(700, 0.05, 'triangle', 0.1);
        break;
    }
  }

  // ------------------------------------------------------------------ music

  startMusic(m: Theme['music'], boss = false) {
    this.musicTheme = m;
    this.boss = boss;
    if (!this.ctx) return;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setBoss(b: boolean) {
    this.boss = b;
  }

  stopMusic() {
    this.musicTheme = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    const c = this.ctx;
    const m = this.musicTheme;
    if (!c || !m) return;
    const tempo = this.boss ? m.tempo + 26 : m.tempo;
    const stepDur = 60 / tempo / 4;
    while (this.nextNote < c.currentTime + 0.12) {
      this.playStep(m, this.step, this.nextNote, stepDur);
      this.nextNote += stepDur;
      this.step = (this.step + 1) % 128;
    }
  }

  private playStep(m: Theme['music'], step: number, t: number, sd: number) {
    const c = this.ctx!;
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const prog = this.boss ? [0, 0, 1, 1, 5, 5, 4, 3] : [0, 0, 3, 3, 4, 4, 2, 4];
    const deg = prog[bar];
    const sc = m.scale;
    const note = (d: number, oct: number) => m.root + oct * 12 + sc[((d % sc.length) + sc.length) % sc.length] + 12 * Math.floor(d / sc.length);
    const play = (freq: number, dur: number, type: OscillatorType, vol: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    // bass
    if (s % 4 === 0 || (this.boss && s % 2 === 0)) play(midi(note(deg, -2)), sd * 3, 'triangle', 0.5);
    // arpeggio
    const pattern = [0, 2, 4, 2, 1, 3, 4, 3];
    if (s % 2 === 0) {
      const d = deg + pattern[(s / 2) % 8] + (bar % 4 === 3 && s > 8 ? 2 : 0);
      play(midi(note(d, 0)), sd * 1.8, 'square', 0.09);
    }
    // little melody on top every other bar
    if (bar % 2 === 1 && (s === 0 || s === 6 || s === 10)) play(midi(note(deg + 4 + (s === 6 ? 1 : 0), 1)), sd * 4, 'sine', 0.12);
    // hats & kick
    if (s % 4 === 2) this.noise(0.04, 0.05, 8000, 0, 1, this.musicBus, t);
    if (s % 8 === 0) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 0.2);
    }
  }
}
