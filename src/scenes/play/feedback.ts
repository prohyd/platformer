// What the player sees and hears when something happens in the run (Observer + lookup table).
// To change the reaction to an event, edit its entry in FEEDBACK.
import type { AudioEngine } from '../../audio/AudioEngine.ts';
import { CONFIG } from '../../config.ts';
import type { Effects } from '../../render/Effects.ts';
import type { Palette } from '../../render/palette.ts';
import type { RunEvent } from '../../rhythm/Run.ts';

export interface FeedbackTargets {
  fx: Effects;
  audio: AudioEngine;
  pal: Palette;
  /** Shake the camera. */
  shake(amount: number): void;
  /** Make the combo counter jump. */
  bumpCombo(): void;
}

type Reaction = (ev: RunEvent, t: FeedbackTargets) => void;

const jumpDust: Reaction = (ev, { fx, pal }) => {
  fx.squash = -0.3;
  fx.particles.burst(ev.x, ev.y + 2, { n: 8, color: [pal.neon, '#fff'], speed: 90, angle: -Math.PI / 2, spread: 2.4, size: 2.2, life: 0.35 });
};

export const FEEDBACK: Record<RunEvent['type'], Reaction> = {
  grade(ev, { fx, audio, pal, bumpCombo }) {
    fx.grade(ev.grade!, ev.x, ev.y, ev.combo ?? 0, pal);
    if (ev.grade !== 'MISS') audio.sound(ev.grade!);
    bumpCombo();
  },

  miss(ev, { fx, audio, shake }) {
    fx.popup(ev.x, ev.y + 70, 'MISS', '#ff4d6d', true);
    fx.missFlash = 1;
    shake(CONFIG.feel.shakeOnMiss);
    fx.particles.burst(ev.x, ev.y + 12, { n: 20, color: ['#ff4d6d', '#fff'], speed: 220, size: 3, life: 0.5, shape: 'square' });
    audio.muffle();
    audio.sound('miss');
  },

  death(ev, { fx, audio, shake }) {
    fx.missFlash = 1.4;
    shake(CONFIG.feel.shakeOnDeath);
    fx.particles.burst(ev.x, ev.y + 12, { n: 40, color: ['#ff9f43', '#ffd29a', '#ff4d6d', '#fff'], speed: 320, size: 3.5, life: 0.8, shape: 'square' });
    fx.particles.add({ x: ev.x, y: ev.y + 12, shape: 'ring', size: 14, life: 0.5, max: 0.5, color: '#fff' });
    audio.muffle();
    audio.fadeOut(0.5);
    audio.sound('miss');
  },

  jump: jumpDust,
  orb: jumpDust,

  land(ev, { fx, pal }) {
    fx.squash = 0.25;
    fx.particles.burst(ev.x, ev.y + 2, { n: 6, color: [pal.neon], speed: 80, angle: Math.PI / 2, spread: 2.6, size: 2, life: 0.3 });
  },

  pad(ev, { fx, audio, pal }) {
    fx.dropFlash = Math.max(fx.dropFlash, 0.5);
    fx.particles.burst(ev.x, ev.y + 4, { n: 30, color: [pal.accent, '#fff', pal.neon2], speed: 300, angle: Math.PI / 2, spread: 1.4, size: 3, life: 0.7, glow: true });
    audio.sound('pad');
  },

  note(ev, { fx, audio, pal }) {
    fx.particles.burst(ev.x, ev.y, { n: 6, color: [pal.neon, '#fff'], speed: 90, size: 2, life: 0.3, glow: true });
    audio.sound('note');
  },
};
