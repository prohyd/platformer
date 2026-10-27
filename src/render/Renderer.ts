// Draws one frame of the world: background, level, hero, effects.
// The UI (menus, HUD) is drawn on top of it by the scenes.
import type { Levels } from '../audio/AudioEngine.ts';
import type { Run } from '../rhythm/Run.ts';
import type { Chart } from '../rhythm/types.ts';
import { applyWorldTransform, Camera, project, toScreen } from './Camera.ts';
import { Effects } from './Effects.ts';
import { Background } from './layers/Background.ts';
import { drawHero, drawTrail } from './layers/hero.ts';
import { drawIdleFloor, drawLevel, type WorldDrawContext } from './layers/world.ts';
import { MusicPulse } from './MusicPulse.ts';
import { palette, type Palette } from './palette.ts';

/** What a scene wants to see in the world this frame. */
export interface WorldView {
  run: Run | null;
  chart: Chart | null;
  songT: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly camera = new Camera();
  readonly pulse = new MusicPulse();
  readonly fx = new Effects();
  pal: Palette = palette(200);
  /** Hue the palette is sliding to (colour changes on new parts of a song). */
  private hueTarget = 200;
  private readonly background = new Background();
  /** Seconds since start. */
  time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.camera.resize(this.canvas);
  }

  /** A new colour scheme and skyline (one per song). */
  setPalette(p: Palette, seed: number) {
    this.pal = p;
    this.hueTarget = p.hue;
    this.background.generateCity(seed);
  }

  /** Slide the colours to another hue (like a colour trigger in Geometry Dash). */
  shiftHue(hue: number) {
    this.hueTarget = hue;
  }

  update(dt: number, lv: Levels, view: WorldView) {
    this.time += dt;
    const dh = this.hueTarget - this.pal.hue;
    if (Math.abs(dh) > 0.5) this.pal = palette(this.pal.hue + dh * Math.min(1, dt * 4));
    this.pulse.update(dt, lv, view.chart ? view.chart.beats : null, view.songT);
    this.fx.update(dt);
    this.camera.update(dt, view.run, this.pulse);
    const run = view.run;
    if (run && run.ghost > 0 && Math.random() < 0.5) {
      this.fx.particles.add({ x: run.x + (Math.random() - 0.5) * 20, y: run.y + Math.random() * 26, vy: 30, size: 2, color: '#ff4d6d', life: 0.3, max: 0.3, glow: true });
    }
  }

  draw(view: WorldView) {
    const { ctx, canvas, camera: cam, pal, pulse, fx } = this;
    const W = canvas.width;
    const H = canvas.height;
    this.background.draw(ctx, W, H, cam, pal, pulse, this.time);

    const proj = project(cam, canvas);
    applyWorldTransform(ctx, proj);
    const dc: WorldDrawContext = { ctx, cam, pal, pulse, time: this.time };
    if (view.chart) drawLevel(dc, view.chart, view.songT);
    else drawIdleFloor(dc);

    const run = view.run;
    if (run && !run.dead) drawTrail(ctx, run, pal);
    fx.particles.draw(ctx);
    if (run && !run.dead) {
      ctx.save();
      const s = toScreen(proj, run.x, run.y);
      ctx.setTransform(proj.k, 0, 0, proj.k, s.x, s.y);
      if (run.ghost > 0 && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.4;
      drawHero(ctx, run, pal, pulse, fx.squash, this.time);
      ctx.restore();
    }
    fx.drawPopups(ctx, proj, cam.dpr);
    fx.drawPost(ctx, W, H, pal, pulse.kick);
  }
}
