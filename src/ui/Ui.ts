// Immediate-mode UI on the canvas.
//
// Every frame the scene calls ui.begin() and then draws widgets; each widget both
// draws itself and registers where it can be clicked. Pointer events then go to
// the widgets registered in the last frame. Coordinates are CSS pixels.
import type { Palette } from '../render/palette.ts';

export const FONT = '"Rubik", "Segoe UI", system-ui, sans-serif';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

interface Hotspot {
  rect: Rect;
  onClick: () => void;
}

interface SliderSpot {
  id: string;
  rect: Rect;
  onChange: (v: number) => void;
}

export function inside(p: Point, r: Rect, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export class Ui {
  readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  /** Current palette (set by the game every frame). */
  pal!: Palette;
  /** Screen size in CSS pixels. */
  W = 0;
  H = 0;
  mouse: Point = { x: -1, y: -1 };
  /** Called on every button click (used for the click sound). */
  onClick: () => void = () => {};
  /** Called when a slider is released. */
  onSliderRelease: () => void = () => {};
  /** Id of the slider being dragged. */
  dragging: string | null = null;
  private hotspots: Hotspot[] = [];
  private sliders: SliderSpot[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Start a UI frame: forget last frame's widgets, switch to CSS pixels. */
  begin(dpr: number, pal: Palette) {
    this.pal = pal;
    this.hotspots = [];
    this.sliders = [];
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = this.canvas.width / dpr;
    this.H = this.canvas.height / dpr;
  }

  /** Forget the widgets drawn so far (for modal panels drawn on top). */
  clearHotspots() {
    this.hotspots = [];
    this.sliders = [];
  }

  // ---------------------------------------------------------------- pointer

  /** Returns true if a widget took the press. */
  pointerDown(p: Point): boolean {
    this.mouse = p;
    const sl = this.sliders.find((s) => inside(p, s.rect, 10));
    if (sl) {
      this.dragging = sl.id;
      this.dragTo(sl);
      return true;
    }
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i];
      if (inside(p, h.rect)) {
        this.onClick();
        h.onClick();
        return true;
      }
    }
    return false;
  }

  pointerMove(p: Point) {
    this.mouse = p;
    if (this.dragging) {
      const sl = this.sliders.find((s) => s.id === this.dragging);
      if (sl) this.dragTo(sl);
    }
  }

  pointerUp() {
    if (this.dragging) {
      this.dragging = null;
      this.onSliderRelease();
    }
  }

  /** Is the pointer over something clickable? (for the cursor) */
  get overWidget() {
    return this.hotspots.some((h) => inside(this.mouse, h.rect)) || this.sliders.some((s) => inside(this.mouse, s.rect, 10));
  }

  hovered(r: Rect) {
    return inside(this.mouse, r);
  }

  private dragTo(sl: SliderSpot) {
    sl.onChange(Math.max(0, Math.min(1, (this.mouse.x - sl.rect.x) / sl.rect.w)));
  }

  // ---------------------------------------------------------------- primitives

  text(s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center', weight = 800, glow = '') {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.6;
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
  }

  panel(x: number, y: number, w: number, h: number, alpha = 0.6, border = 'rgba(255,255,255,0.12)') {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(8,4,20,${alpha})`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Darken the whole screen. */
  dim(alpha: number, rgb = '5,0,15') {
    this.ctx.fillStyle = `rgba(${rgb},${alpha})`;
    this.ctx.fillRect(0, 0, this.W, this.H);
  }

  /** A clickable area without any drawing. */
  hotspot(rect: Rect, onClick: () => void) {
    this.hotspots.push({ rect, onClick });
  }

  button(rect: Rect, label: string, onClick: () => void, opts: { primary?: boolean; active?: boolean } = {}) {
    const { x, y, w, h } = rect;
    const ctx = this.ctx;
    const p = this.pal;
    const hov = this.hovered(rect);
    this.hotspot(rect, onClick);
    ctx.fillStyle = opts.primary ? p.neon2 : opts.active ? 'rgba(255,255,255,0.22)' : hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = opts.active || hov ? p.neon : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = opts.active ? 2.5 : 1.5;
    ctx.stroke();
    if (label) this.text(label, x + w / 2, y + h / 2 + 1, Math.min(18, h * 0.42), opts.primary ? '#14061f' : '#fff', 'center', 800);
  }

  /** A small square button with a custom icon. */
  iconButton(x: number, y: number, onClick: () => void, drawIcon: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void) {
    this.hotspot({ x, y, w: 40, h: 40 }, onClick);
    this.panel(x, y, 40, 40, 0.5);
    drawIcon(this.ctx, x + 20, y + 20);
  }

  /** A horizontal slider 0..1. */
  slider(id: string, rect: Rect, value: number, color: string, onChange: (v: number) => void) {
    const ctx = this.ctx;
    const { x, y, w, h } = rect;
    this.sliders.push({ id, rect: { x, y: y - 4, w, h: h + 8 }, onChange });
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * value), h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + w * value, y + h / 2, this.dragging === id ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();
  }
}
