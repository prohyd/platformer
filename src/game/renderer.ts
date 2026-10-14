import { BOSS_H, BOSS_W, ROLLER_R, WAVE_H, WAVE_W } from '../engine/boss.ts';
import { PLAYER_H as PH, PLAYER_W as PW, SAW_RADIUS, TILE } from '../engine/constants.ts';
import {
  ALT,
  BLUE,
  CRUMBLE,
  DOOR,
  GPORTAL,
  ONEWAY,
  pathPos,
  RED,
  SOLID,
  SPIKE_DOWN,
  SPIKE_UP,
  SPRING,
  type Point,
} from '../engine/level.ts';
import type { Sim } from '../engine/sim.ts';
import { Particles } from './particles.ts';
import { hash2, LAYER_H, makeBackground, N, E, S, W, PAD, rng, TileCache, type BgLayer } from './textures.ts';
import { THEMES, type Theme } from './themes.ts';

export const VIEW_H = 540;
const MIN_VIEW_W = 640;
const MAX_VIEW_H = 680;

interface Deco {
  x: number;
  y: number;
  kind: number;
  seed: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  ph: number;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  speed: number;
}

const tmp: Point = { x: 0, y: 0 };

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** device pixels per world pixel */
  scale = 1;
  dpr = 1;
  viewW = 960;
  viewH = VIEW_H;
  camX = 0;
  camY = 0;
  shake = 0;
  flash = 0;
  flashColor = '#fff';
  theme: Theme = THEMES.meadow;
  tiles: TileCache | null = null;
  layers: BgLayer[] = [];
  decos: Deco[] = [];
  motes: Mote[] = [];
  clouds: Cloud[] = [];
  particles = new Particles();
  litFlags = new Set<number>();
  springAnim = new Map<number, number>();
  orbFlash = new Map<number, number>();
  toggleFlash = 0;
  squash = 0;
  time = 0;
  private levelSeed = 1;
  private bgKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    let scale = this.canvas.height / VIEW_H;
    if (this.canvas.width / scale < MIN_VIEW_W) scale = this.canvas.width / MIN_VIEW_W;
    // On tall screens do not show more than MAX_VIEW_H of the world vertically.
    scale = Math.max(scale, this.canvas.height / MAX_VIEW_H);
    this.scale = scale;
    this.viewW = this.canvas.width / scale;
    this.viewH = this.canvas.height / scale;
    this.tiles = new TileCache(this.theme, scale);
    this.bgKey = '';
  }

  setTheme(th: Theme, seed: number) {
    this.theme = th;
    this.levelSeed = seed;
    this.tiles = new TileCache(th, this.scale);
    this.bgKey = '';
    const rand = rng(seed * 13 + 7);
    this.motes = [];
    for (let i = 0; i < 46; i++) {
      this.motes.push({ x: rand() * 2000, y: rand() * 1200, vx: (rand() - 0.5) * 20, vy: (rand() - 0.5) * 20, s: 1 + rand() * 2.2, ph: rand() * 6.28 });
    }
    this.clouds = [];
    for (let i = 0; i < 9; i++) this.clouds.push({ x: rand() * 3000, y: 30 + rand() * 200, s: 0.6 + rand() * 0.9, speed: 4 + rand() * 10 });
  }

  private ensureBackground() {
    const key = `${this.theme.id}_${this.scale.toFixed(3)}_${this.levelSeed}`;
    if (key === this.bgKey) return;
    this.bgKey = key;
    this.layers = makeBackground(this.theme, Math.min(this.scale, 1.6), this.levelSeed);
  }

  /** Prepare per-level decoration. */
  setLevel(sim: Sim) {
    const L = sim.L;
    this.setTheme(THEMES[L.def.theme], L.w * 31 + L.h);
    this.decos = [];
    this.litFlags.clear();
    this.springAnim.clear();
    this.orbFlash.clear();
    this.particles.list = [];
    const rand = rng(L.w * 7 + 3);
    for (let ty = 1; ty < L.h; ty++) {
      for (let tx = 0; tx < L.w; tx++) {
        if (L.tiles[ty * L.w + tx] !== SOLID) continue;
        if (L.tiles[(ty - 1) * L.w + tx] !== 0) continue;
        if (rand() < 0.28) this.decos.push({ x: tx * TILE + 6 + rand() * 20, y: ty * TILE, kind: (rand() * 4) | 0, seed: (rand() * 1e6) | 0 });
      }
    }
    this.snapCamera(sim);
  }

  snapCamera(sim: Sim) {
    const t = this.cameraTarget(sim, sim.p.x, sim.p.y);
    this.camX = t.x;
    this.camY = t.y;
  }

  private cameraTarget(sim: Sim, px: number, py: number) {
    const L = sim.L;
    const lw = L.w * TILE;
    const lh = L.h * TILE;
    let x = px + PW / 2 + sim.p.dir * 110 - this.viewW / 2;
    let y = py + PH / 2 - this.viewH * 0.55;
    x = Math.max(0, Math.min(lw - this.viewW, x));
    if (lw < this.viewW) x = (lw - this.viewW) / 2;
    y = Math.min(lh - this.viewH, Math.max(Math.min(0, lh - this.viewH), y));
    return { x, y };
  }

  // ------------------------------------------------------------------ events → effects

  effect(ev: { t: string; x: number; y: number; v?: number }, sim: Sim) {
    const P = this.particles;
    const th = this.theme;
    const dust = th.id === 'volcano' ? ['#6b5560', '#4a3a45'] : th.id === 'caves' ? ['#8a80b8', '#5f5690'] : ['#e8dcc8', '#c9b79a'];
    const g = sim.grav;
    switch (ev.t) {
      case 'jump':
      case 'walljump':
        this.squash = -0.28;
        P.burst(ev.x, ev.y + (g === 1 ? 12 : -12), { n: 7, color: dust, speed: 70, angle: g === 1 ? Math.PI / 2 : -Math.PI / 2, spread: 2.6, size: 3, life: 0.4 });
        break;
      case 'orb':
        this.squash = -0.3;
        break;
      case 'orbUsed':
        this.orbFlash.set(ev.v ?? 0, 0.4);
        P.burst(ev.x, ev.y, { n: 14, color: ['#fff3a0', '#ffd23f'], speed: 160, size: 2.5, life: 0.5, shape: 'star', glow: true });
        P.add({ x: ev.x, y: ev.y, shape: 'ring', size: 8, life: 0.4, max: 0.4, color: '#ffe46b' });
        break;
      case 'land':
        if ((ev.v ?? 0) > 250) {
          this.squash = Math.min(0.35, (ev.v ?? 0) / 2600);
          P.burst(ev.x, ev.y, { n: 6, color: dust, speed: 90, angle: g === 1 ? -Math.PI / 2 : Math.PI / 2, spread: 2.8, size: 2.5, life: 0.35, drag: 5 });
        }
        break;
      case 'wallHit':
        P.burst(ev.x, ev.y, { n: 4, color: dust, speed: 50, size: 2, life: 0.3 });
        break;
      case 'spring':
        this.squash = -0.4;
        this.springAnim.set(Math.floor(ev.x / TILE) + Math.floor(ev.y / TILE) * 100000, 0.35);
        P.burst(ev.x, ev.y, { n: 10, color: ['#fff', th.accent], speed: 140, angle: -Math.PI / 2, spread: 1.6, size: 2.5, life: 0.4 });
        break;
      case 'crumble':
        for (let i = 0; i < 6; i++) {
          P.add({ x: ev.x - 12 + Math.random() * 24, y: ev.y - 10 + Math.random() * 20, vx: (Math.random() - 0.5) * 60, vy: -40 + Math.random() * 40, g: 1200, size: 4 + Math.random() * 3, color: i % 2 ? '#c9894a' : '#9a6232', shape: 'square', life: 0.9, max: 0.9 });
        }
        break;
      case 'crumbleBack':
        P.burst(ev.x, ev.y, { n: 6, color: ['#fff', '#f0d090'], speed: 40, size: 2, life: 0.3 });
        break;
      case 'toggle':
        this.toggleFlash = 0.18;
        break;
      case 'gravity':
        P.burst(ev.x, ev.y, { n: 16, color: ['#d48bff', '#8f5bff', '#fff'], speed: 160, size: 2.5, life: 0.5, glow: true });
        this.flash = 0.12;
        this.flashColor = '#b07bff';
        break;
      case 'coin':
        P.burst(ev.x, ev.y, { n: 12, color: ['#fff', '#7df9ff', '#b5fffa'], speed: 120, size: 2.5, life: 0.45, shape: 'star', glow: true });
        P.add({ x: ev.x, y: ev.y, shape: 'ring', size: 6, life: 0.35, max: 0.35, color: '#bffcff' });
        break;
      case 'checkpoint':
        this.litFlags.add(ev.v ?? 0);
        P.burst(ev.x, ev.y, { n: 18, color: ['#7dff8a', '#fff', '#c6ffcb'], speed: 150, size: 2.5, life: 0.6, shape: 'star', glow: true });
        break;
      case 'death': {
        this.shake = 10;
        this.flash = 0.25;
        this.flashColor = '#ff5050';
        P.burst(ev.x, ev.y, { n: 26, color: ['#ff9f43', '#ffd29a', '#e8384f', '#fff'], speed: 260, size: 3.5, life: 0.7, g: 600, shape: 'square' });
        P.add({ x: ev.x, y: ev.y, shape: 'ring', size: 10, life: 0.4, max: 0.4, color: '#fff' });
        break;
      }
      case 'respawn':
        P.burst(ev.x, ev.y, { n: 14, color: ['#fff', '#ffd29a'], speed: 90, size: 2.5, life: 0.4, glow: true });
        this.squash = 0.3;
        break;
      case 'win':
        P.burst(ev.x, ev.y, { n: 40, color: ['#fff', '#ffe27a', '#7df9ff', '#d48bff'], speed: 260, size: 3, life: 1, shape: 'star', glow: true });
        this.flash = 0.3;
        this.flashColor = '#fff';
        break;
      case 'doorClose':
        this.shake = 8;
        break;
      case 'bossIntro':
        this.shake = 14;
        break;
      case 'bossSlam':
        this.shake = 14;
        P.burst(ev.x, ev.y, { n: 30, color: ['#ff8c3a', '#6b5560', '#ffd08a'], speed: 280, angle: -Math.PI / 2, spread: 3, size: 4, life: 0.6, g: 900 });
        break;
      case 'bossHit':
        this.shake = 10;
        this.flash = 0.15;
        this.flashColor = '#ffffff';
        P.burst(ev.x, ev.y, { n: 24, color: ['#fff', '#ffe27a', '#ff8c3a'], speed: 240, size: 3, life: 0.5, shape: 'star', glow: true });
        break;
      case 'bossBoom':
        this.shake = 6;
        P.burst(ev.x, ev.y, { n: 16, color: ['#fff', '#ffb066', '#ff5a1f', '#444'], speed: 200, size: 4, life: 0.6, glow: true });
        break;
      case 'bossDead':
        this.shake = 20;
        this.flash = 0.5;
        this.flashColor = '#fff';
        P.burst(ev.x, ev.y, { n: 80, color: ['#fff', '#ffe27a', '#ff8c3a', '#ff5a1f'], speed: 380, size: 4, life: 1.2, glow: true, shape: 'star' });
        break;
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, sim: Sim | null, alpha: number) {
    this.time += dt;
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt);
    this.toggleFlash = Math.max(0, this.toggleFlash - dt);
    this.squash *= Math.exp(-dt * 12);
    for (const [k, v] of this.springAnim) v - dt <= 0 ? this.springAnim.delete(k) : this.springAnim.set(k, v - dt);
    for (const [k, v] of this.orbFlash) v - dt <= 0 ? this.orbFlash.delete(k) : this.orbFlash.set(k, v - dt);
    if (sim) {
      const px = sim.prevX + (sim.p.x - sim.prevX) * alpha;
      const py = sim.prevY + (sim.p.y - sim.prevY) * alpha;
      const t = this.cameraTarget(sim, px, py);
      const kx = 1 - Math.exp(-dt * 6);
      const ky = 1 - Math.exp(-dt * 4);
      this.camX += (t.x - this.camX) * kx;
      this.camY += (t.y - this.camY) * ky;
      // trail while flying fast (springs, orbs)
      if (!sim.dead && Math.abs(sim.p.vy) > 700 && Math.random() < 0.6) {
        this.particles.add({ x: px + PW / 2 + (Math.random() - 0.5) * 10, y: py + PH / 2, size: 2, color: this.theme.accent, life: 0.3, max: 0.3, glow: true });
      }
      if (sim.p.wallSlide && !sim.dead && Math.random() < 0.4) {
        this.particles.add({ x: px + (sim.p.dir > 0 ? PW : 0), y: py + PH * 0.7, vy: -20, size: 2, color: '#ccc', life: 0.3, max: 0.3 });
      }
    }
  }

  /** Draws the world. alpha = interpolation factor between sim ticks. */
  render(sim: Sim, alpha: number) {
    const ctx = this.ctx;
    const s = this.scale;
    this.ensureBackground();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky();

    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const cx = Math.round((this.camX + sx) * s) / s;
    const cy = Math.round((this.camY + sy) * s) / s;

    this.drawLayers(sim, cx, cy);

    ctx.setTransform(s, 0, 0, s, -cx * s, -cy * s);
    const time = sim.time - (1 - alpha) * (1 / 60);
    this.drawLava(sim, cx);
    this.drawRails(sim, cx);
    this.drawTiles(sim, cx, cy, time);
    this.drawDecos(cx);
    this.drawObjects(sim, time);
    if (sim.boss) this.drawBoss(sim);
    if (!sim.dead) {
      const px = sim.prevX + (sim.p.x - sim.prevX) * alpha;
      const py = sim.prevY + (sim.p.y - sim.prevY) * alpha;
      this.drawPlayer(ctx, px, py, sim.p.dir, sim.grav, sim);
    }
    this.particles.draw(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMotes();
    this.drawVignette();
    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, this.flash * 2);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ background

  drawSky() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const th = this.theme;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.55, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (th.sun) {
      const big = th.id === 'ruins';
      const x = w * (big ? 0.7 : 0.8);
      const y = h * (big ? 0.55 : 0.18);
      const r = h * (big ? 0.13 : 0.07);
      const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 4);
      glow.addColorStop(0, 'rgba(255,240,200,0.55)');
      glow.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = th.sun;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (th.id === 'caves' || th.id === 'volcano') {
      // faint stars / ash
      const rand = rng(42);
      ctx.fillStyle = th.id === 'caves' ? 'rgba(200,220,255,0.5)' : 'rgba(255,160,120,0.35)';
      for (let i = 0; i < 70; i++) {
        const tw = 0.5 + 0.5 * Math.sin(this.time * 2 + i);
        ctx.globalAlpha = tw;
        ctx.fillRect(rand() * w, rand() * h * 0.7, 1.5 * this.dpr, 1.5 * this.dpr);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawLayers(sim: Sim, cx: number, cy: number) {
    const ctx = this.ctx;
    const s = this.scale;
    const maxCamY = sim.L.h * TILE - this.viewH;
    const th = this.theme;
    // clouds behind the far layer for open-air themes
    if (th.id === 'meadow' || th.id === 'ruins') {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      for (const c of this.clouds) {
        const span = this.viewW + 400;
        let x = (((c.x - cx * 0.06 + this.time * c.speed) % span) + span) % span - 200;
        const y = c.y + (maxCamY - cy) * 0.04;
        this.drawCloud(x, y, c.s, th.id === 'ruins' ? 'rgba(255,220,230,0.75)' : 'rgba(255,255,255,0.9)');
        x += 0;
      }
    }
    for (const l of this.layers) {
      const off = (maxCamY - cy) * l.parallax * 0.6;
      const y = this.viewH - LAYER_H + off + 20;
      if (th.id === 'caves' && l === this.layers[0] && y > 0) {
        // the cave ceiling continues above the far layer
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.fillStyle = th.far;
        ctx.fillRect(0, 0, this.viewW, y + 2);
      }
      let x = -((cx * l.parallax) % l.width);
      if (x > 0) x -= l.width;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      for (; x < this.viewW; x += l.width) ctx.drawImage(l.img, x, y, l.width, LAYER_H);
      // fill below the layer so tall views don't show sky under hills
      const bottom = y + LAYER_H;
      if (bottom < this.viewH) {
        ctx.fillStyle = l === this.layers[this.layers.length - 1] ? th.near : th.mid;
        ctx.fillRect(0, bottom - 1, this.viewW, this.viewH - bottom + 1);
      }
    }
  }

  private drawCloud(x: number, y: number, k: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, 60 * k, 18 * k, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 30 * k, y + 2, 34 * k, 14 * k, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 10 * k, y - 14 * k, 34 * k, 22 * k, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 40 * k, y - 2, 28 * k, 14 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMotes() {
    const ctx = this.ctx;
    const th = this.theme;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const t = this.time;
    ctx.fillStyle = th.ambientColor;
    for (const m of this.motes) {
      let x: number, y: number, a: number;
      switch (th.ambient) {
        case 'embers':
          x = m.x + Math.sin(t + m.ph) * 20;
          y = m.y - t * (40 + m.s * 20);
          a = 0.5 + 0.5 * Math.sin(t * 5 + m.ph);
          break;
        case 'fireflies':
          x = m.x + Math.sin(t * 0.5 + m.ph) * 40;
          y = m.y + Math.cos(t * 0.4 + m.ph) * 30;
          a = Math.max(0, Math.sin(t * 1.5 + m.ph));
          break;
        default:
          x = m.x + t * (12 + m.vx);
          y = m.y + Math.sin(t + m.ph) * 15 + t * 4;
          a = 0.6;
      }
      x = (((x - this.camX * 0.8) % 2000) + 2000) % 2000;
      y = (((y - this.camY * 0.8) % 1200) + 1200) % 1200;
      const X = (x / 2000) * w;
      const Y = (y / 1200) * h;
      ctx.globalAlpha = a * 0.8;
      if (th.ambient === 'fireflies' || th.ambient === 'embers') {
        ctx.shadowColor = th.ambientColor;
        ctx.shadowBlur = 8 * this.dpr;
      }
      ctx.beginPath();
      ctx.arc(X, Y, m.s * this.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private drawVignette() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, this.theme.id === 'volcano' ? 'rgba(60,0,0,0.45)' : 'rgba(0,0,20,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawLava(sim: Sim, cx: number) {
    if (this.theme.id !== 'volcano') return;
    const ctx = this.ctx;
    const y = sim.L.h * TILE - 14;
    const g = ctx.createLinearGradient(0, y - 80, 0, y + 20);
    g.addColorStop(0, 'rgba(255,90,20,0)');
    g.addColorStop(1, 'rgba(255,90,20,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(cx, y - 80, this.viewW, 100);
    ctx.fillStyle = '#ff6a1a';
    ctx.beginPath();
    ctx.moveTo(cx, y + 30);
    for (let x = cx - (cx % 8); x <= cx + this.viewW + 8; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + this.time * 3) * 3);
    ctx.lineTo(cx + this.viewW + 8, y + 30);
    ctx.fill();
    ctx.fillStyle = '#ffc04a';
    ctx.fillRect(cx, y + 6, this.viewW, 2);
  }

  // ------------------------------------------------------------------ tiles

  private isSolidish(sim: Sim, tx: number, ty: number) {
    const L = sim.L;
    if (tx < 0 || tx >= L.w || ty >= L.h) return true;
    if (ty < 0) return false;
    const t = L.tiles[ty * L.w + tx];
    return t === SOLID || t === ALT;
  }

  private drawTiles(sim: Sim, cx: number, cy: number, time: number) {
    const ctx = this.ctx;
    const L = sim.L;
    const th = this.theme;
    const tx0 = Math.max(0, Math.floor(cx / TILE) - 1);
    const tx1 = Math.min(L.w - 1, Math.floor((cx + this.viewW) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(cy / TILE) - 1);
    const ty1 = Math.min(L.h - 1, Math.floor((cy + this.viewH) / TILE) + 1);
    const S2 = TILE + PAD * 2;

    // pass 1: static solids
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = L.tiles[ty * L.w + tx];
        if (t === SOLID) {
          let mask = 0;
          if (this.isSolidish(sim, tx, ty - 1)) mask |= N;
          if (this.isSolidish(sim, tx + 1, ty)) mask |= E;
          if (this.isSolidish(sim, tx, ty + 1)) mask |= S;
          if (this.isSolidish(sim, tx - 1, ty)) mask |= W;
          ctx.drawImage(this.tiles!.get('ground', mask, hash2(tx, ty) % 4), tx * TILE - PAD, ty * TILE - PAD, S2, S2);
        } else if (t === ALT) {
          ctx.drawImage(this.tiles!.get('alt', 0, hash2(tx, ty) % 3), tx * TILE - PAD, ty * TILE - PAD, S2, S2);
        }
      }
    }

    // pass 2: special tiles
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * L.w + tx;
        const t = L.tiles[i];
        const x = tx * TILE;
        const y = ty * TILE;
        switch (t) {
          case ONEWAY:
            this.drawOneWay(x, y, L.tiles[i - 1] === ONEWAY, L.tiles[i + 1] === ONEWAY);
            break;
          case CRUMBLE: {
            const id = L.crumbleId[i];
            const st = sim.crumbleState[id];
            if (st === 2) {
              ctx.globalAlpha = 0.15;
              ctx.strokeStyle = '#fff';
              ctx.setLineDash([3, 3]);
              ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
              ctx.setLineDash([]);
              ctx.globalAlpha = 1;
              break;
            }
            const shake = st === 1 ? (Math.random() - 0.5) * 3 : 0;
            this.drawCrumble(x + shake, y + (st === 1 ? Math.random() * 1.5 : 0), st === 1 ? 1 - sim.crumbleTimer[id] / 0.45 : 0, hash2(tx, ty));
            break;
          }
          case RED:
          case BLUE:
            this.drawToggle(x, y, t === RED, (t === RED) === (sim.toggle === 0));
            break;
          case SPIKE_UP:
          case SPIKE_DOWN:
            this.drawSpikes(x, y, t === SPIKE_DOWN);
            break;
          case SPRING:
            this.drawSpring(x, y, this.springAnim.get(tx + (ty + 1) * 100000) ?? this.springAnim.get(tx + ty * 100000) ?? 0);
            break;
          case DOOR:
            if (sim.doorClosed) this.drawDoor(x, y);
            break;
          case GPORTAL:
            this.drawGravityPortal(x, y, time, L.tiles[i - L.w] === GPORTAL, L.tiles[i + L.w] === GPORTAL);
            break;
        }
      }
    }
    void th;
  }

  private drawOneWay(x: number, y: number, left: boolean, right: boolean) {
    const ctx = this.ctx;
    const th = this.theme;
    const wood = th.id === 'caves' ? '#7a6aa8' : th.id === 'volcano' ? '#5a4c60' : '#b07a48';
    const dark = th.id === 'caves' ? '#4d4175' : th.id === 'volcano' ? '#2f2533' : '#7a4f2a';
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + 2, TILE, 11);
    ctx.fillStyle = wood;
    ctx.fillRect(x, y, TILE, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 15, y + 1, 2, 8);
    if (!left) {
      ctx.fillRect(x + 2, y + 9, 3, 10);
    }
    if (!right) {
      ctx.fillRect(x + TILE - 5, y + 9, 3, 10);
    }
  }

  private drawCrumble(x: number, y: number, crack: number, h: number) {
    const ctx = this.ctx;
    const th = this.theme;
    const base = th.id === 'caves' ? '#b7a3e0' : th.id === 'volcano' ? '#8a5040' : '#e0b070';
    const dark = th.id === 'caves' ? '#7a68a8' : th.id === 'volcano' ? '#5a2c22' : '#a8743a';
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, TILE - 2, TILE - 2, 4);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, TILE - 4, TILE - 7, 3);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const r = rng(h);
    let cx = x + 8 + r() * 16;
    let cy = y + 2;
    ctx.moveTo(cx, cy);
    for (let i = 0; i < 4; i++) {
      cx += (r() - 0.5) * 12;
      cy += 6;
      ctx.lineTo(cx, cy);
    }
    ctx.moveTo(x + 2, y + 14);
    ctx.lineTo(x + 10, y + 17);
    ctx.stroke();
    if (crack > 0) {
      ctx.strokeStyle = 'rgba(40,20,10,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + 4 + 24 * crack, y + 4 + 22 * crack);
      ctx.moveTo(x + 28, y + 6);
      ctx.lineTo(x + 28 - 20 * crack, y + 6 + 20 * crack);
      ctx.stroke();
    }
  }

  private drawToggle(x: number, y: number, red: boolean, solid: boolean) {
    const ctx = this.ctx;
    const main = red ? '#ff4d6d' : '#3fa7ff';
    const dark = red ? '#a8183a' : '#1660b0';
    const light = red ? '#ffb0bf' : '#b8e0ff';
    if (solid) {
      const pulse = this.toggleFlash > 0 ? 3 : 0;
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.roundRect(x + 1 - pulse / 2, y + 1 - pulse / 2, TILE - 2 + pulse, TILE - 2 + pulse, 5);
      ctx.fill();
      const g = ctx.createLinearGradient(x, y, x, y + TILE);
      g.addColorStop(0, light);
      g.addColorStop(0.3, main);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, TILE - 6, TILE - 6, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      if (red) {
        ctx.fillRect(x + 12, y + 12, 8, 8);
      } else {
        ctx.beginPath();
        ctx.arc(x + 16, y + 16, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = main;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this.time * 10;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, TILE - 6, TILE - 6, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = main;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawSpikes(x: number, y: number, down: boolean) {
    const ctx = this.ctx;
    const th = this.theme;
    const volc = th.id === 'volcano';
    ctx.save();
    if (down) {
      ctx.translate(x + TILE, y + TILE);
      ctx.rotate(Math.PI);
      x = 0;
      y = 0;
    } else {
      ctx.translate(x, y);
    }
    for (let i = 0; i < 3; i++) {
      const bx = i * 10.67;
      const g = ctx.createLinearGradient(bx, 0, bx + 10.67, 0);
      g.addColorStop(0, volc ? '#3a2a33' : '#d9e1ea');
      g.addColorStop(0.5, volc ? '#5b4652' : '#ffffff');
      g.addColorStop(0.51, volc ? '#2a1d25' : '#9aa6b4');
      g.addColorStop(1, volc ? '#1d141a' : '#7d8896');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, TILE);
      ctx.lineTo(bx + 5.33, 12);
      ctx.lineTo(bx + 10.17, TILE);
      ctx.fill();
      if (volc) {
        ctx.fillStyle = '#ff8c3a';
        ctx.shadowColor = '#ff5a1f';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(bx + 3.5, 18);
        ctx.lineTo(bx + 5.33, 12);
        ctx.lineTo(bx + 7.2, 18);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.fillStyle = volc ? '#1d141a' : '#5d6672';
    ctx.fillRect(0, TILE - 3, TILE, 3);
    ctx.restore();
  }

  private drawSpring(x: number, y: number, anim: number) {
    const ctx = this.ctx;
    const k = anim > 0 ? Math.sin((anim / 0.35) * Math.PI) : 0;
    const top = y + 18 - k * 10;
    ctx.fillStyle = '#4a4f5a';
    ctx.fillRect(x + 4, y + 28, 24, 4);
    ctx.strokeStyle = '#c0c6d0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const yy = y + 28 - ((y + 28 - top - 4) * i) / n;
      ctx.lineTo(x + (i % 2 ? 24 : 8), yy);
    }
    ctx.stroke();
    ctx.fillStyle = '#e8384f';
    ctx.beginPath();
    ctx.roundRect(x + 3, top - 2, 26, 6, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x + 6, top - 1, 20, 1.5);
  }

  private drawDoor(x: number, y: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#2b2233';
    ctx.fillRect(x + 2, y, TILE - 4, TILE);
    ctx.fillStyle = '#5a4c60';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 5 + i * 9, y, 4, TILE);
    ctx.fillStyle = '#ff6a2a';
    ctx.shadowColor = '#ff6a2a';
    ctx.shadowBlur = 8;
    ctx.fillRect(x + 2, y + 14, TILE - 4, 3);
    ctx.shadowBlur = 0;
  }

  private drawGravityPortal(x: number, y: number, time: number, up: boolean, down: boolean) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x, 0, x + TILE, 0);
    g.addColorStop(0, 'rgba(160,90,255,0)');
    g.addColorStop(0.5, 'rgba(190,120,255,0.55)');
    g.addColorStop(1, 'rgba(160,90,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, y, TILE + 12, TILE);
    ctx.strokeStyle = 'rgba(240,220,255,0.8)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      const ph = time * 3 + i * 3 + y * 0.05;
      ctx.beginPath();
      for (let yy = 0; yy <= TILE; yy += 4) {
        const xx = x + 16 + Math.sin(ph + yy * 0.2) * 8;
        if (yy === 0) ctx.moveTo(xx, y + yy);
        else ctx.lineTo(xx, y + yy);
      }
      ctx.stroke();
    }
    // arrows
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const a = ((time * 40 + y) % TILE) - 4;
    ctx.beginPath();
    ctx.moveTo(x + 11, y + a + 6);
    ctx.lineTo(x + 16, y + a);
    ctx.lineTo(x + 21, y + a + 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 11, y + TILE - a - 6);
    ctx.lineTo(x + 16, y + TILE - a);
    ctx.lineTo(x + 21, y + TILE - a - 6);
    ctx.fill();
    if (!up || !down) {
      ctx.fillStyle = '#6a3fb0';
      if (!up) ctx.fillRect(x + 2, y - 3, TILE - 4, 5);
      if (!down) ctx.fillRect(x + 2, y + TILE - 2, TILE - 4, 5);
    }
  }

  // ------------------------------------------------------------------ decorations

  private drawDecos(cx: number) {
    const ctx = this.ctx;
    const th = this.theme;
    for (const d of this.decos) {
      if (d.x < cx - 40 || d.x > cx + this.viewW + 40) continue;
      const sway = Math.sin(this.time * 2 + d.seed) * 1.5;
      const r = rng(d.seed);
      ctx.save();
      ctx.translate(d.x, d.y);
      switch (th.id) {
        case 'meadow':
          if (d.kind === 0) {
            // flower
            ctx.strokeStyle = '#3c9c38';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(sway, -5, sway, -10);
            ctx.stroke();
            const col = ['#ff6b8b', '#ffd23f', '#ffffff', '#b38bff'][(r() * 4) | 0];
            ctx.fillStyle = col;
            for (let i = 0; i < 5; i++) {
              const a = (i / 5) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(sway + Math.cos(a) * 3, -10 + Math.sin(a) * 3, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#ffb000';
            ctx.beginPath();
            ctx.arc(sway, -10, 1.6, 0, Math.PI * 2);
            ctx.fill();
          } else if (d.kind === 1) {
            ctx.fillStyle = '#4fb840';
            for (let i = -2; i <= 2; i++) {
              ctx.beginPath();
              ctx.moveTo(i * 2.5 - 1.5, 0);
              ctx.lineTo(i * 3 + sway, -6 - r() * 6);
              ctx.lineTo(i * 2.5 + 1.5, 0);
              ctx.fill();
            }
          } else if (d.kind === 2) {
            ctx.fillStyle = '#f2e6d0';
            ctx.fillRect(-1.5, -6, 3, 6);
            ctx.fillStyle = '#e8384f';
            ctx.beginPath();
            ctx.ellipse(0, -6, 6, 4, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillRect(-3, -8, 1.5, 1.5);
            ctx.fillRect(2, -7.5, 1.5, 1.5);
          } else {
            ctx.fillStyle = '#9aa5b1';
            ctx.beginPath();
            ctx.ellipse(0, -2, 5, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(-2, -4.5, 3, 1.5);
          }
          break;
        case 'caves':
          if (d.kind < 2) {
            const col = d.kind === 0 ? '#7df9ff' : '#d38bff';
            ctx.shadowColor = col;
            ctx.shadowBlur = 10;
            ctx.fillStyle = col;
            for (let i = -1; i <= 1; i++) {
              const h = 8 + r() * 8;
              ctx.beginPath();
              ctx.moveTo(i * 4 - 2.5, 0);
              ctx.lineTo(i * 4 + i * 1.5, -h);
              ctx.lineTo(i * 4 + 2.5, 0);
              ctx.fill();
            }
            ctx.shadowBlur = 0;
          } else if (d.kind === 2) {
            ctx.fillStyle = '#c9b8ff';
            ctx.fillRect(-1, -6, 2, 6);
            ctx.fillStyle = '#5be0c0';
            ctx.shadowColor = '#5be0c0';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.ellipse(0, -6, 5, 3, 0, Math.PI, 0);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
          break;
        case 'ruins':
          if (d.kind === 0) {
            ctx.fillStyle = '#c9b7a4';
            ctx.fillRect(-4, -14, 8, 14);
            ctx.fillRect(-6, -3, 12, 3);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(-1, -14, 2, 11);
          } else if (d.kind === 1) {
            ctx.fillStyle = '#c86a3a';
            ctx.beginPath();
            ctx.moveTo(-3, -12);
            ctx.lineTo(3, -12);
            ctx.quadraticCurveTo(7, -6, 3, 0);
            ctx.lineTo(-3, 0);
            ctx.quadraticCurveTo(-7, -6, -3, -12);
            ctx.fill();
            ctx.fillStyle = '#ffd27a';
            ctx.fillRect(-4, -7, 8, 1.5);
          } else {
            ctx.fillStyle = '#e8c860';
            for (let i = -2; i <= 2; i++) {
              ctx.beginPath();
              ctx.moveTo(i * 2.5 - 1.2, 0);
              ctx.lineTo(i * 3 + sway, -5 - r() * 5);
              ctx.lineTo(i * 2.5 + 1.2, 0);
              ctx.fill();
            }
          }
          break;
        case 'volcano':
          if (d.kind === 0) {
            const a = 0.5 + 0.5 * Math.sin(this.time * 3 + d.seed);
            ctx.fillStyle = `rgba(255,${100 + a * 80},40,${0.5 + a * 0.5})`;
            ctx.shadowColor = '#ff6a2a';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.ellipse(0, -1, 5, 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          } else if (d.kind === 1) {
            ctx.fillStyle = '#54465a';
            ctx.beginPath();
            ctx.moveTo(-5, 0);
            ctx.lineTo(-2, -9);
            ctx.lineTo(3, -6);
            ctx.lineTo(5, 0);
            ctx.fill();
          }
          break;
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ objects

  private drawRails(sim: Sim, cx: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = this.theme.id === 'meadow' ? 'rgba(80,50,30,0.35)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 6]);
    for (const m of sim.L.movers) {
      if (Math.max(m.ax, m.bx) + m.w < cx - 50 || Math.min(m.ax, m.bx) > cx + this.viewW + 50) continue;
      ctx.beginPath();
      ctx.moveTo(m.ax + m.w / 2, m.ay + 7);
      ctx.lineTo(m.bx + m.w / 2, m.by + 7);
      ctx.stroke();
    }
    for (const s of sim.L.saws) {
      if (s.period === 0) continue;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawObjects(sim: Sim, time: number) {
    const ctx = this.ctx;
    const L = sim.L;
    const t = this.time;

    // movers
    for (const m of L.movers) {
      const p = pathPos(m, time, tmp);
      this.drawMover(p.x, p.y, m.w);
    }

    // saws
    for (const s of L.saws) {
      const p = pathPos(s, time, tmp);
      this.drawSaw(p.x, p.y, t * 14);
    }

    // orbs
    for (let i = 0; i < L.orbs.length; i++) {
      const o = L.orbs[i];
      const cd = sim.orbCd[i] > 0;
      const pulse = 1 + Math.sin(t * 5 + i) * 0.08;
      const fl = this.orbFlash.get(i) ?? 0;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.scale(pulse + fl, pulse + fl);
      ctx.globalAlpha = cd ? 0.35 : 1;
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#ffe46b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,240,150,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-3, -4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // gems
    for (let i = 0; i < L.coins.length; i++) {
      if (sim.coinsTaken[i]) continue;
      const c = L.coins[i];
      const bob = Math.sin(t * 3 + i * 0.7) * 3;
      const sx = Math.cos(t * 2.5 + i);
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.shadowColor = '#7df9ff';
      ctx.shadowBlur = 12;
      ctx.scale(Math.max(0.15, Math.abs(sx)), 1);
      ctx.fillStyle = sx > 0 ? '#5ee8ff' : '#3cc4e8';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, -2);
      ctx.lineTo(0, 9);
      ctx.lineTo(-7, -2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#d8ffff';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, -2);
      ctx.lineTo(0, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // checkpoints
    for (let i = 0; i < L.flags.length; i++) {
      const f = L.flags[i];
      const lit = this.litFlags.has(i);
      const flipped = sim.grav === -1 && sim.cp.flag === i ? true : false;
      const bx = f.x * TILE + 10;
      const by = flipped ? f.y * TILE : f.y * TILE + TILE;
      const d = flipped ? 1 : -1;
      ctx.fillStyle = '#d0d4dc';
      ctx.fillRect(bx, Math.min(by, by + d * 44), 3, 44);
      ctx.fillStyle = '#7d8896';
      ctx.fillRect(bx - 3, flipped ? by : by - 3, 9, 3);
      const col = lit ? '#4ade80' : '#e8384f';
      ctx.fillStyle = col;
      if (lit) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
      }
      ctx.beginPath();
      const fy = by + d * 42;
      ctx.moveTo(bx + 3, fy);
      for (let k = 0; k <= 4; k++) {
        const xx = bx + 3 + k * 4.5;
        ctx.lineTo(xx, fy - d * Math.sin(t * 6 + k) * 1.5);
      }
      for (let k = 4; k >= 0; k--) {
        const xx = bx + 3 + k * 4.5;
        ctx.lineTo(xx, fy - d * 13 - d * Math.sin(t * 6 + k) * 1.5);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // exit portal
    const e = L.exit;
    if (e && sim.exitOpen) {
      const x = e.x * TILE + 16;
      const y = e.y * TILE;
      ctx.save();
      ctx.translate(x, y);
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
      glow.addColorStop(0, 'rgba(255,255,255,0.9)');
      glow.addColorStop(0.4, 'rgba(160,240,255,0.5)');
      glow.addColorStop(1, 'rgba(120,120,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 0, 44, 50, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = ['#ffffff', '#7df9ff', '#d48bff', '#ffe27a'][k];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 14 + k * 3, 26 + k * 3, 0, t * (2 + k) + k, t * (2 + k) + k + 4.2);
        ctx.stroke();
      }
      ctx.restore();
      if (Math.random() < 0.3) {
        this.particles.add({ x: x + (Math.random() - 0.5) * 30, y: y + 20, vy: -60, size: 2, color: '#bffcff', life: 0.8, max: 0.8, glow: true });
      }
    }
  }

  private drawMover(x: number, y: number, w: number) {
    const ctx = this.ctx;
    const th = this.theme;
    const top = th.id === 'caves' ? '#7df9ff' : th.id === 'volcano' ? '#ff8c3a' : '#ffd23f';
    ctx.fillStyle = '#2f3542';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#5d6577';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, 10, 3);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.fillRect(x + 2, y, w - 4, 3);
    ctx.fillStyle = '#2f3542';
    for (let i = 0; i < w / 16; i++) {
      ctx.beginPath();
      ctx.arc(x + 8 + i * 16, y + 7, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // hazard stripes underside
    ctx.fillStyle = 'rgba(255,210,63,0.6)';
    for (let i = 0; i < w; i += 8) ctx.fillRect(x + i + 1, y + 12, 4, 2);
  }

  private drawSaw(x: number, y: number, rot: number) {
    const ctx = this.ctx;
    const r = SAW_RADIUS + 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = '#c8ced8';
    ctx.beginPath();
    const teeth = 12;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 ? r - 4 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6d7684';
    ctx.lineWidth = 1;
    ctx.stroke();
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, r - 4);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#8a94a3');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8384f';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ boss

  private drawBoss(sim: Sim) {
    const b = sim.boss!;
    const ctx = this.ctx;
    const t = this.time;
    if (b.state === 'idle' || b.state === 'dead') return;

    // shockwaves
    for (const w of b.waves) {
      const x = w.x;
      const y = b.floorY;
      ctx.fillStyle = '#ff6a2a';
      ctx.shadowColor = '#ff8c3a';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + WAVE_W / 2 - w.dir * 4, y - WAVE_H * 2, x + WAVE_W, y);
      ctx.fill();
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(x + 4, y);
      ctx.quadraticCurveTo(x + WAVE_W / 2, y - WAVE_H, x + WAVE_W - 4, y);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (Math.random() < 0.5) this.particles.add({ x: x + WAVE_W / 2, y: y - 4, vx: -w.dir * 40, vy: -60, size: 2.5, color: '#ffb066', life: 0.3, max: 0.3 });
    }
    // rollers
    for (const r of b.rollers) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.fillStyle = '#2b2233';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? ROLLER_R - 1 : ROLLER_R + 5;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
      ctx.fillStyle = '#ff6a2a';
      ctx.shadowColor = '#ff6a2a';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, ROLLER_R - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    let x = b.x;
    let y = b.y;
    if (b.state === 'windup') {
      x += (Math.random() - 0.5) * 4;
      y += (Math.random() - 0.5) * 2;
    }
    const stunned = b.state === 'stunned';
    const w = BOSS_W;
    const h = BOSS_H;
    ctx.save();
    ctx.translate(x, y);

    // shadow on floor
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const dist = b.floorY - (y + h);
    const sw = Math.max(20, w * (1 - dist / 500));
    ctx.beginPath();
    ctx.ellipse(x + w / 2, b.floorY - 2, sw / 2, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);

    if (b.state === 'dying') {
      ctx.globalAlpha = 0.6 + Math.random() * 0.4;
    }
    // jets under the boss while flying
    if (!stunned && b.state !== 'slam') {
      for (const jx of [18, w - 18]) {
        const fl = 14 + Math.random() * 10;
        const g = ctx.createLinearGradient(0, h, 0, h + fl);
        g.addColorStop(0, '#ffe27a');
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(jx - 8, h - 2);
        ctx.lineTo(jx, h + fl);
        ctx.lineTo(jx + 8, h - 2);
        ctx.fill();
      }
    }
    // body
    const body = ctx.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#54465a');
    body.addColorStop(1, '#2b2233');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(4, 14, w - 8, h - 14, 14);
    ctx.fill();
    ctx.strokeStyle = '#1a1420';
    ctx.lineWidth = 3;
    ctx.stroke();
    // lava cracks
    ctx.strokeStyle = b.flash > 0 ? '#ffffff' : '#ff6a2a';
    ctx.shadowColor = '#ff5a1f';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(14, 40);
    ctx.lineTo(24, 52);
    ctx.lineTo(18, 66);
    ctx.moveTo(w - 14, 36);
    ctx.lineTo(w - 26, 50);
    ctx.lineTo(w - 20, 70);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // crown / head plate (the weak spot)
    const headCol = stunned ? `hsl(${50 + Math.sin(t * 12) * 10},100%,${60 + Math.sin(t * 12) * 10}%)` : '#7a6680';
    ctx.fillStyle = headCol;
    if (stunned) {
      ctx.shadowColor = '#ffe27a';
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.moveTo(10, 18);
    ctx.lineTo(18, 0);
    ctx.lineTo(30, 12);
    ctx.lineTo(w / 2, -6);
    ctx.lineTo(w - 30, 12);
    ctx.lineTo(w - 18, 0);
    ctx.lineTo(w - 10, 18);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // eyes
    const eyeY = 34;
    if (stunned) {
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 3;
      for (const ex of [w / 2 - 18, w / 2 + 18]) {
        ctx.beginPath();
        for (let a = 0; a < 12; a += 0.5) ctx.lineTo(ex + Math.cos(a + t * 8) * a * 0.6, eyeY + Math.sin(a + t * 8) * a * 0.6);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = b.state === 'windup' ? '#fff' : '#ffe27a';
      ctx.shadowColor = '#ff8c3a';
      ctx.shadowBlur = 14;
      for (const ex of [w / 2 - 18, w / 2 + 18]) {
        ctx.beginPath();
        ctx.moveTo(ex - 9, eyeY - 3 + (ex < w / 2 ? -3 : 3));
        ctx.lineTo(ex + 9, eyeY - 3 + (ex < w / 2 ? 3 : -3));
        ctx.lineTo(ex + 7, eyeY + 5);
        ctx.lineTo(ex - 7, eyeY + 5);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    // mouth grill
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(w / 2 - 20, 54, 40, 10);
    ctx.fillStyle = '#ff6a2a';
    for (let i = 0; i < 5; i++) ctx.fillRect(w / 2 - 18 + i * 8, 56, 4, 6);
    if (b.flash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-10, -10, w + 20, h + 20);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // arrow hint above the head when vulnerable
    if (stunned) {
      const ay = y - 26 + Math.sin(t * 8) * 4;
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - 9, ay);
      ctx.lineTo(x + w / 2 + 9, ay);
      ctx.lineTo(x + w / 2, ay + 10);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ player

  drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, grav: number, sim: Sim | null, scaleUp = 1) {
    const t = this.time;
    const cx = x + PW / 2;
    const feet = grav === 1 ? y + PH : y;
    const grounded = sim ? sim.p.grounded : true;
    const sliding = sim ? sim.p.wallSlide : false;
    const vy = sim ? sim.p.vy * grav : 0;
    let sq = this.squash;
    if (!grounded && !sliding) sq += Math.max(-0.15, Math.min(0.1, -vy / 4000));
    const sx = 1 + sq;
    const sy = 1 - sq;
    ctx.save();
    ctx.translate(cx, feet);
    if (grav === -1) ctx.scale(1, -1);
    ctx.scale(scaleUp, scaleUp);

    // scarf
    const wave = Math.sin(t * 16) * 2.5;
    const lift = grounded ? 0 : Math.max(-6, Math.min(6, vy / 120));
    ctx.strokeStyle = '#e8384f';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dir * 6, -12 * sy);
    ctx.quadraticCurveTo(-dir * 14, -12 * sy + wave + lift, -dir * 22, -8 * sy - wave + lift * 1.5);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-dir * 6, -11 * sy);
    ctx.quadraticCurveTo(-dir * 12, -7 * sy - wave + lift, -dir * 18, -4 * sy + wave + lift * 1.5);
    ctx.stroke();

    ctx.scale(sx, sy);
    // feet
    const step = grounded ? Math.sin(t * 22) * 3 : 0;
    ctx.fillStyle = '#5a2a12';
    ctx.beginPath();
    ctx.ellipse(-5 + step, -2, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(5 - step, -2, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, -28, 0, 0);
    g.addColorStop(0, '#ffb35c');
    g.addColorStop(1, '#f27a1a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-13, -27, 26, 25, 9);
    ctx.fill();
    ctx.strokeStyle = '#7a3510';
    ctx.lineWidth = 2;
    ctx.stroke();
    // belly
    ctx.fillStyle = '#ffe0b0';
    ctx.beginPath();
    ctx.ellipse(dir * 2, -9, 7, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // scarf knot
    ctx.fillStyle = '#e8384f';
    ctx.beginPath();
    ctx.roundRect(-12, -15, 24, 4, 2);
    ctx.fill();
    // eyes
    const blink = t % 3.7 < 0.12 ? 0.15 : 1;
    const ex = dir * 3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex - 5, -21, 4, 5 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(ex + 5, -21, 4, 5 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = '#1b1020';
      const py = sliding ? -19 : -21 + Math.max(-1.5, Math.min(1.5, vy / 400));
      ctx.beginPath();
      ctx.arc(ex - 5 + dir * 1.6, py, 2.2, 0, Math.PI * 2);
      ctx.arc(ex + 5 + dir * 1.6, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(ex - 5 + dir * 1.6 - 1.4, py - 1.6, 1.2, 1.2);
      ctx.fillRect(ex + 5 + dir * 1.6 - 1.4, py - 1.6, 1.2, 1.2);
    }
    // cheeks
    ctx.fillStyle = 'rgba(255,90,90,0.35)';
    ctx.beginPath();
    ctx.ellipse(ex - 9, -15, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.ellipse(ex + 9, -15, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.roundRect(-9, -25, 7, 3, 1.5);
    ctx.fill();
    ctx.restore();
  }
}
