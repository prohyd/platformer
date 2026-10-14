// Short-lived visual feedback: particles, floating words, screen flashes, squash.
import { CONFIG } from '../config.ts';
import type { Grade } from '../rhythm/Scorer.ts';
import { toScreen, type Projection } from './Camera.ts';
import { GRADE_COLORS, type Palette } from './palette.ts';
import { Particles } from './particles.ts';

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  big: boolean;
}

export class Effects {
  readonly particles = new Particles();
  private popups: Popup[] = [];
  /** White flash (drops, big combos), 0..1. */
  dropFlash = 0;
  /** Red flash (mistakes). */
  missFlash = 0;
  /** Squash & stretch of the hero: <0 stretched (jump), >0 squashed (landing). */
  squash = 0;

  update(dt: number) {
    this.particles.update(dt);
    for (const p of this.popups) {
      p.life -= dt;
      p.y += dt * 60;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    this.dropFlash = Math.max(0, this.dropFlash - dt * 1.5);
    this.missFlash = Math.max(0, this.missFlash - dt * 2.5);
    this.squash *= Math.exp(-dt * 12);
  }

  /** A floating word at a world position. */
  popup(x: number, y: number, text: string, color: string, big = false) {
    this.popups.push({ x, y, text, color, life: 0.8, big });
  }

  /** Feedback for a judged press. */
  grade(g: Grade, x: number, y: number, combo: number, pal: Palette) {
    const col = GRADE_COLORS[g];
    this.popup(x, y + 70, g, col, g === 'PERFECT');
    const n = g === 'PERFECT' ? 22 : g === 'GREAT' ? 14 : 8;
    this.particles.burst(x, y + 10, { n, color: [col, '#fff', pal.neon], speed: g === 'PERFECT' ? 260 : 160, size: 2.6, life: 0.5, shape: 'star', glow: true });
    this.particles.add({ x, y: y + 10, shape: 'ring', size: 10, life: 0.35, max: 0.35, color: col });
    if (combo > 0 && combo % CONFIG.score.comboCallout === 0) {
      this.popup(x, y + 120, `${combo} КОМБО!`, pal.accent, true);
      this.dropFlash = Math.max(this.dropFlash, 0.4);
    }
  }

  /** Floating words, drawn in screen space. */
  drawPopups(ctx: CanvasRenderingContext2D, proj: Projection, dpr: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of this.popups) {
      const s = toScreen(proj, p.x, p.y);
      const size = (p.big ? 30 : 22) * dpr * (1 + (1 - Math.min(1, (0.8 - p.life) * 8)) * 0.4);
      ctx.globalAlpha = Math.min(1, p.life * 3);
      ctx.font = `900 ${size}px "Rubik", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 16 * dpr;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, s.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  /** Full-screen glow and flashes on top of everything. */
  drawPost(ctx: CanvasRenderingContext2D, W: number, H: number, pal: Palette, kick: number) {
    // edge glow with the bass
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `hsla(${pal.hue + 300}, 100%, 55%, ${0.12 + 0.3 * kick})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (this.dropFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.dropFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.missFlash > 0) {
      ctx.fillStyle = `rgba(255,40,80,${this.missFlash * 0.3})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
