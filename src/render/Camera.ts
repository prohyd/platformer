// Screen size, scale, and the camera that follows the runner.
import { CONFIG } from '../config.ts';
import type { Run } from '../rhythm/Run.ts';
import type { MusicPulse } from './MusicPulse.ts';

/** How much of the world is visible vertically, in world pixels. */
export const VIEW_H = 540;

export class Camera {
  /** Device pixels per CSS pixel. */
  dpr = 1;
  /** Device pixels per world pixel. */
  k = 1;
  /** Visible world size. */
  viewW = 960;
  viewH = VIEW_H;
  /** Left edge of the view in world x. */
  x = 0;
  /** World y that sits on the "floor line" of the screen. */
  y = 0;
  /** Height of the floor the runner last stood on. */
  private ground = 0;
  zoom = 1;
  shake = 0;

  /** Fit the canvas to the window. */
  resize(canvas: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.dpr = dpr;
    let k = canvas.height / VIEW_H;
    if (canvas.width / k < 700) k = canvas.width / 700;
    k = Math.max(k, canvas.height / 760);
    this.k = k;
    this.viewW = canvas.width / k;
    this.viewH = canvas.height / k;
  }

  update(dt: number, run: Run | null, pulse: MusicPulse) {
    this.shake = Math.max(0, this.shake - dt * 40);
    const targetZoom = 1 + CONFIG.feel.kickZoom * Math.min(1, pulse.kick) + CONFIG.feel.beatZoom * pulse.beatPulse;
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 20);
    if (run) {
      // the runner stays at 30% of the width; the floor line follows it softly.
      // In the air the camera keeps the floor in view and only rises for really high flights.
      this.x = run.x - this.viewW * 0.3;
      if (run.grounded) this.ground = run.y;
      const ty = run.grounded ? run.y : Math.max(this.ground, run.y - 170);
      this.y += (ty - this.y) * Math.min(1, dt * 3);
    } else {
      this.x += dt * 260;
    }
  }

  /** Is the world range [x0, x1] on screen? */
  visible(x0: number, x1: number) {
    return x1 >= this.x - 100 && x0 <= this.x + this.viewW / this.zoom + 200;
  }
}

/** Screen-space mapping for one frame (includes zoom and shake). */
export interface Projection {
  /** Device pixels per world pixel this frame. */
  k: number;
  /** Screen point where the runner is. */
  px: number;
  py: number;
  /** World x under px. */
  cx: number;
  /** World y under py. */
  cy: number;
  sx: number;
  sy: number;
}

export function project(cam: Camera, canvas: HTMLCanvasElement): Projection {
  const sx = cam.shake ? (Math.random() - 0.5) * cam.shake * cam.dpr : 0;
  const sy = cam.shake ? (Math.random() - 0.5) * cam.shake * cam.dpr : 0;
  return { k: cam.k * cam.zoom, px: canvas.width * 0.3, py: canvas.height * 0.7, cx: cam.x + cam.viewW * 0.3, cy: cam.y, sx, sy };
}

/** World point -> device pixels. */
export function toScreen(p: Projection, x: number, y: number) {
  return { x: p.px + (x - p.cx) * p.k + p.sx, y: p.py - (y - p.cy) * p.k + p.sy };
}

/** Make the context draw in world coordinates (y up). */
export function applyWorldTransform(ctx: CanvasRenderingContext2D, p: Projection) {
  ctx.setTransform(p.k, 0, 0, -p.k, p.px - p.cx * p.k + p.sx, p.py + p.cy * p.k + p.sy);
}
