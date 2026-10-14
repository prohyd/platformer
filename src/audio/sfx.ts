// Small synthesized sound effects. To add a sound, add an entry to SOUNDS.

export type SoundName = 'PERFECT' | 'GREAT' | 'GOOD' | 'note' | 'miss' | 'pad' | 'click';

/** Tiny synthesizer that plays one-shot sounds into an output node. */
export class Synth {
  private readonly ctx: AudioContext;
  private readonly out: AudioNode;
  private readonly noise: AudioBuffer;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** A beep; `to` makes the pitch slide. */
  tone(freq: number, dur: number, type: OscillatorType, vol: number, to?: number) {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A burst of filtered noise. */
  hiss(dur: number, vol: number, freq: number) {
    const c = this.ctx;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }
}

export const SOUNDS: Record<SoundName, (s: Synth) => void> = {
  PERFECT: (s) => s.tone(1760, 0.06, 'sine', 0.12),
  GREAT: (s) => s.tone(1320, 0.05, 'sine', 0.08),
  GOOD: () => {},
  note: (s) => s.tone(2093, 0.05, 'triangle', 0.05),
  miss: (s) => {
    s.hiss(0.25, 0.35, 700);
    s.tone(220, 0.25, 'sawtooth', 0.06, 70);
  },
  pad: (s) => s.tone(300, 0.4, 'sine', 0.15, 1200),
  click: (s) => s.tone(900, 0.04, 'triangle', 0.08),
};
