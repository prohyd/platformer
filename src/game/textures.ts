// Procedural textures: tile sprites and parallax background layers, drawn once and cached.
import { TILE } from '../engine/constants.ts';
import type { Theme } from './themes.ts';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export const PAD = 8;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Neighbour mask bits
export const N = 1, E = 2, S = 4, W = 8;

function roundedTile(ctx: CanvasRenderingContext2D, mask: number, r: number) {
  const tl = !(mask & N) && !(mask & W) ? r : 0;
  const tr = !(mask & N) && !(mask & E) ? r : 0;
  const br = !(mask & S) && !(mask & E) ? r : 0;
  const bl = !(mask & S) && !(mask & W) ? r : 0;
  // Bleed 1px into solid neighbours so scaled tiles never show seams.
  const l = mask & W ? 1 : 0;
  const t = mask & N ? 1 : 0;
  const rr = mask & E ? 1 : 0;
  const b = mask & S ? 1 : 0;
  ctx.beginPath();
  ctx.roundRect(-l, -t, TILE + l + rr, TILE + t + b, [tl, tr, br, bl]);
}

function speckles(ctx: CanvasRenderingContext2D, rand: () => number, color: string, n: number, size: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const s = size * (0.5 + rand());
    ctx.fillRect(rand() * (TILE - s), rand() * (TILE - s), s, s);
  }
}

function edgeShade(ctx: CanvasRenderingContext2D, mask: number, color: string, w: number) {
  ctx.fillStyle = color;
  if (!(mask & E)) ctx.fillRect(TILE - w, 0, w, TILE);
  if (!(mask & W)) ctx.fillRect(0, 0, w, TILE);
  if (!(mask & S)) ctx.fillRect(0, TILE - w, TILE, w);
}

function drawGround(ctx: CanvasRenderingContext2D, th: Theme, mask: number, v: number) {
  const rand = rng(v * 7919 + mask * 31 + 3);
  ctx.save();
  roundedTile(ctx, mask, 7);
  ctx.fillStyle = th.ground;
  ctx.fill();
  ctx.clip();

  if (th.id === 'ruins') {
    // Sandstone bricks
    ctx.strokeStyle = th.groundDark;
    ctx.lineWidth = 1.5;
    for (let row = 0; row < 2; row++) {
      const y = row * 16;
      ctx.beginPath();
      ctx.moveTo(0, y + 16);
      ctx.lineTo(TILE, y + 16);
      const off = (row + v) % 2 ? 0 : 16;
      ctx.moveTo(off, y);
      ctx.lineTo(off, y + 16);
      ctx.stroke();
    }
    speckles(ctx, rand, th.groundLight, 6, 2);
    speckles(ctx, rand, th.groundDark, 5, 1.5);
  } else if (th.id === 'volcano') {
    speckles(ctx, rand, th.groundLight, 7, 2.5);
    speckles(ctx, rand, th.groundDark, 8, 2);
    // Glowing cracks
    ctx.strokeStyle = 'rgba(255,90,30,0.85)';
    ctx.shadowColor = '#ff5a1f';
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let x = rand() * TILE;
    let y = 0;
    ctx.moveTo(x, y);
    for (let i = 0; i < 4; i++) {
      x += (rand() - 0.5) * 14;
      y += 6 + rand() * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    speckles(ctx, rand, th.groundLight, 7, 2.5);
    speckles(ctx, rand, th.groundDark, 9, 2);
    // Pebbles
    for (let i = 0; i < 2; i++) {
      if (rand() < 0.5) continue;
      ctx.fillStyle = th.id === 'caves' ? '#7a70a6' : '#b48a6a';
      ctx.beginPath();
      ctx.ellipse(4 + rand() * 24, 8 + rand() * 20, 2.5 + rand() * 2, 2 + rand() * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (th.id === 'caves' && rand() < 0.35) {
      const cx = 6 + rand() * 20, cy = 10 + rand() * 16;
      ctx.fillStyle = rand() < 0.5 ? '#7df9ff' : '#d38bff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 2.5, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx - 2.5, cy);
      ctx.fill();
    }
  }
  edgeShade(ctx, mask, 'rgba(0,0,0,0.22)', 3);
  ctx.restore();

  if (!(mask & N)) {
    // Top layer: grass / moss / gold trim / hot crust
    ctx.save();
    ctx.fillStyle = th.topDark;
    ctx.beginPath();
    ctx.roundRect(0, -1, TILE, 10, [!(mask & W) ? 6 : 0, !(mask & E) ? 6 : 0, 3, 3]);
    ctx.fill();
    ctx.fillStyle = th.top;
    ctx.beginPath();
    ctx.roundRect(0, -2, TILE, 7, [!(mask & W) ? 5 : 0, !(mask & E) ? 5 : 0, 2, 2]);
    ctx.fill();
    if (th.id === 'meadow' || th.id === 'caves') {
      // blades / drips hanging over the edge
      for (let i = 0; i < 7; i++) {
        const bx = 2 + i * 4.5 + rand() * 2;
        const bh = 3 + rand() * 4;
        ctx.fillStyle = rand() < 0.5 ? th.top : th.topDark;
        ctx.beginPath();
        ctx.moveTo(bx - 1.6, 4);
        ctx.lineTo(bx, 4 + bh);
        ctx.lineTo(bx + 1.6, 4);
        ctx.fill();
        if (th.id === 'meadow' && rand() < 0.6) {
          ctx.fillStyle = th.top;
          ctx.beginPath();
          ctx.moveTo(bx - 1.5, -1);
          ctx.lineTo(bx + (rand() - 0.5) * 2, -3 - rand() * 4);
          ctx.lineTo(bx + 1.5, -1);
          ctx.fill();
        }
      }
    } else if (th.id === 'ruins') {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, -1, TILE, 1.5);
      ctx.fillStyle = th.topDark;
      for (let i = 0; i < 4; i++) ctx.fillRect(3 + i * 8, 1, 3, 2);
    } else {
      ctx.fillStyle = 'rgba(255,200,120,0.6)';
      ctx.fillRect(0, -1, TILE, 1.2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(!(mask & W) ? 4 : 0, -1.5, TILE - (!(mask & W) ? 4 : 0) - (!(mask & E) ? 4 : 0), 1.2);
    ctx.restore();
  }
}

function drawAlt(ctx: CanvasRenderingContext2D, th: Theme, v: number) {
  const rand = rng(v * 131 + 17);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, TILE - 1, TILE - 1, 4);
  ctx.fillStyle = th.alt;
  ctx.fill();
  ctx.clip();
  // bevel
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, 0, TILE, 4);
  ctx.fillRect(0, 0, 4, TILE);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, TILE - 4, TILE, 4);
  ctx.fillRect(TILE - 4, 0, 4, TILE);
  ctx.strokeStyle = th.altDark;
  ctx.lineWidth = 1.2;
  if (th.id === 'volcano') {
    ctx.fillStyle = th.altDark;
    for (const [x, y] of [[7, 7], [25, 7], [7, 25], [25, 25]]) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeRect(7, 7, TILE - 14, TILE - 14);
  }
  if (rand() < 0.5) {
    ctx.beginPath();
    let x = rand() * TILE, y = 0;
    ctx.moveTo(x, y);
    for (let i = 0; i < 3; i++) {
      x += (rand() - 0.5) * 12;
      y += 5 + rand() * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckles(ctx, rand, 'rgba(0,0,0,0.12)', 6, 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, TILE - 1, TILE - 1, 4);
  ctx.stroke();
}

export class TileCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private th: Theme;
  private scale: number;
  constructor(th: Theme, scale: number) {
    this.th = th;
    this.scale = scale;
  }

  get(kind: 'ground' | 'alt', mask: number, variant: number): HTMLCanvasElement {
    const key = `${kind}${mask}_${variant}`;
    let c = this.cache.get(key);
    if (c) return c;
    const s = this.scale;
    c = canvas((TILE + PAD * 2) * s, (TILE + PAD * 2) * s);
    const ctx = c.getContext('2d')!;
    ctx.scale(s, s);
    ctx.translate(PAD, PAD);
    if (kind === 'ground') drawGround(ctx, this.th, mask, variant);
    else drawAlt(ctx, this.th, variant);
    this.cache.set(key, c);
    return c;
  }
}

// ------------------------------------------------------------------ backgrounds

export interface BgLayer {
  img: HTMLCanvasElement;
  width: number;
  parallax: number;
  y: number;
}

export const LAYER_W = 1600;
export const LAYER_H = 560;

function silhouette(ctx: CanvasRenderingContext2D, rand: () => number, base: number, amp: number, rough: number, color: string, w = LAYER_W) {
  const pts: number[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) pts.push(0);
  // sum of sines that tiles seamlessly
  const waves = [1, 2, 3, 5, 8].map((f) => ({ f, a: rand() * amp / f ** (1 - rough * 0.5), p: rand() * Math.PI * 2 }));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, LAYER_H);
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    let y = base;
    for (const wv of waves) y -= wv.a * Math.sin((i / n) * Math.PI * 2 * wv.f + wv.p);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, LAYER_H);
  ctx.closePath();
  ctx.fill();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x - h * 0.05, y - h * 0.4, h * 0.1, h * 0.4);
  ctx.beginPath();
  ctx.arc(x, y - h * 0.62, h * 0.3, 0, Math.PI * 2);
  ctx.arc(x - h * 0.18, y - h * 0.45, h * 0.22, 0, Math.PI * 2);
  ctx.arc(x + h * 0.18, y - h * 0.45, h * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + h * 0.28, y);
  ctx.lineTo(x - h * 0.28, y);
  ctx.fill();
}

function crystal(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, flip = false) {
  const d = flip ? -1 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - h * 0.18, y);
  ctx.lineTo(x - h * 0.12, y - h * 0.75 * d);
  ctx.lineTo(x, y - h * d);
  ctx.lineTo(x + h * 0.12, y - h * 0.75 * d);
  ctx.lineTo(x + h * 0.18, y);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.05, y);
  ctx.lineTo(x, y - h * d);
  ctx.lineTo(x + h * 0.12, y - h * 0.75 * d);
  ctx.lineTo(x + h * 0.08, y);
  ctx.fill();
}

function column(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, color: string, broken: boolean) {
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillRect(x - w * 0.7, y - h - 8, w * 1.4, 8);
  ctx.fillRect(x - w * 0.7, y - 8, w * 1.4, 8);
  if (broken) {
    ctx.clearRect(x - w, y - h - 10, w * 2, 14);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h + 4);
    ctx.lineTo(x, y - h - 6);
    ctx.lineTo(x + w / 2, y - h + 10);
    ctx.lineTo(x + w / 2, y - h + 14);
    ctx.lineTo(x - w / 2, y - h + 14);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 1; i < 4; i++) ctx.fillRect(x - w / 2 + (w / 4) * i - 1, y - h + 6, 2, h - 14);
}

function island(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, top: string, body: string) {
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.3, y + w * 0.35, x, y + w * 0.55);
  ctx.quadraticCurveTo(x + w * 0.3, y + w * 0.35, x + w / 2, y);
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2, w * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function makeBackground(th: Theme, scale: number, seed: number): BgLayer[] {
  const rand = rng(seed * 97 + 5);
  const layers: BgLayer[] = [];
  const mk = (parallax: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = canvas(LAYER_W * scale, LAYER_H * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    draw(ctx);
    layers.push({ img: c, width: LAYER_W, parallax, y: 0 });
  };

  switch (th.id) {
    case 'meadow':
      mk(0.12, (ctx) => {
        silhouette(ctx, rand, 330, 90, 0.8, th.far);
        // snow caps
        ctx.globalCompositeOperation = 'source-atop';
        const g = ctx.createLinearGradient(0, 200, 0, 300);
        g.addColorStop(0, 'rgba(255,255,255,0.85)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, LAYER_W, 300);
        ctx.globalCompositeOperation = 'source-over';
      });
      mk(0.3, (ctx) => {
        silhouette(ctx, rand, 420, 40, 0.3, th.mid);
        for (let i = 0; i < 26; i++) {
          const x = rand() * LAYER_W;
          tree(ctx, x, 440 + rand() * 30, 40 + rand() * 30, '#5aa860');
        }
      });
      mk(0.55, (ctx) => {
        silhouette(ctx, rand, 490, 25, 0.2, th.near);
        for (let i = 0; i < 18; i++) {
          const x = rand() * LAYER_W;
          if (rand() < 0.5) pine(ctx, x, 500 + rand() * 20, 70 + rand() * 50, '#2f7a45');
          else tree(ctx, x, 505 + rand() * 20, 70 + rand() * 40, '#337f48');
        }
      });
      break;
    case 'caves':
      mk(0.12, (ctx) => {
        silhouette(ctx, rand, 380, 70, 0.9, th.far);
        ctx.save();
        ctx.translate(0, LAYER_H);
        ctx.scale(1, -1);
        silhouette(ctx, rand, 470, 60, 1, th.far);
        ctx.restore();
      });
      mk(0.3, (ctx) => {
        for (let i = 0; i < 40; i++) {
          const x = rand() * LAYER_W;
          crystal(ctx, x, 470 + rand() * 60, 50 + rand() * 90, i % 3 ? th.mid : '#3c2c78');
          crystal(ctx, rand() * LAYER_W, 0, 40 + rand() * 80, th.mid, true);
        }
      });
      mk(0.55, (ctx) => {
        for (let i = 0; i < 16; i++) {
          const x = rand() * LAYER_W;
          const col = rand() < 0.5 ? 'rgba(125,249,255,0.30)' : 'rgba(211,139,255,0.30)';
          ctx.shadowColor = col;
          ctx.shadowBlur = 20;
          crystal(ctx, x, 560, 80 + rand() * 120, col);
        }
        ctx.shadowBlur = 0;
      });
      break;
    case 'ruins':
      mk(0.1, (ctx) => {
        for (let i = 0; i < 9; i++) {
          const x = rand() * LAYER_W;
          island(ctx, x, 200 + rand() * 200, 60 + rand() * 80, '#c88aa0', th.far);
        }
      });
      mk(0.3, (ctx) => {
        for (let i = 0; i < 14; i++) {
          const x = (i + rand() * 0.5) * (LAYER_W / 14);
          column(ctx, x, 560, 140 + rand() * 180, 22 + rand() * 10, th.mid, rand() < 0.5);
        }
      });
      mk(0.55, (ctx) => {
        for (let i = 0; i < 7; i++) {
          const x = rand() * LAYER_W;
          island(ctx, x, 380 + rand() * 120, 100 + rand() * 90, '#9a5f88', th.near);
        }
      });
      break;
    case 'volcano':
      mk(0.12, (ctx) => {
        for (let i = 0; i < 4; i++) {
          const x = (i + 0.5) * (LAYER_W / 4) + (rand() - 0.5) * 200;
          const h = 220 + rand() * 120;
          ctx.fillStyle = th.far;
          ctx.beginPath();
          ctx.moveTo(x - 300, LAYER_H);
          ctx.lineTo(x - 40, LAYER_H - h);
          ctx.lineTo(x + 40, LAYER_H - h);
          ctx.lineTo(x + 300, LAYER_H);
          ctx.fill();
          const g = ctx.createLinearGradient(0, LAYER_H - h, 0, LAYER_H - h + 120);
          g.addColorStop(0, 'rgba(255,120,40,0.9)');
          g.addColorStop(1, 'rgba(255,60,20,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x - 40, LAYER_H - h);
          ctx.lineTo(x - 12, LAYER_H - h + 140);
          ctx.lineTo(x + 6, LAYER_H - h + 90);
          ctx.lineTo(x + 40, LAYER_H - h);
          ctx.fill();
        }
      });
      mk(0.3, (ctx) => silhouette(ctx, rand, 450, 60, 1.2, th.mid));
      mk(0.55, (ctx) => {
        silhouette(ctx, rand, 510, 30, 1.4, th.near);
        for (let i = 0; i < 12; i++) {
          const x = rand() * LAYER_W;
          const h = 60 + rand() * 90;
          ctx.fillStyle = th.near;
          ctx.beginPath();
          ctx.moveTo(x - 14, 540);
          ctx.lineTo(x - 4, 540 - h);
          ctx.lineTo(x + 6, 540 - h * 0.8);
          ctx.lineTo(x + 16, 540);
          ctx.fill();
        }
      });
      break;
  }
  return layers;
}
