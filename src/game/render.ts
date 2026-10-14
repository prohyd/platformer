import type { Levels } from '../audio/engine.ts';
import { CEIL_H, PH, SPIKE_H, type Chart } from '../rhythm/chart.ts';
import type { Grade, Run } from '../rhythm/run.ts';
import { Particles } from './particles.ts';

export const VIEW_H = 540;

export interface Palette {
  hue: number;
  skyTop: string;
  skyBot: string;
  neon: string;
  neon2: string;
  accent: string;
  ground: string;
  groundDeep: string;
}

export function palette(hue: number): Palette {
  return {
    hue,
    skyTop: `hsl(${hue + 230}, 55%, 7%)`,
    skyBot: `hsl(${hue + 290}, 60%, 20%)`,
    neon: `hsl(${hue}, 100%, 62%)`,
    neon2: `hsl(${hue + 300}, 100%, 66%)`,
    accent: `hsl(${hue + 50}, 100%, 65%)`,
    ground: `hsl(${hue + 240}, 45%, 13%)`,
    groundDeep: `hsl(${hue + 240}, 50%, 5%)`,
  };
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  big: boolean;
}

interface Building {
  x: number;
  w: number;
  band: number;
  base: number;
  layer: number;
  seed: number;
}

const GRADE_COLORS: Record<Grade, string> = { PERFECT: '#7df9ff', GREAT: '#7dff9a', GOOD: '#ffe27a', MISS: '#ff4d6d' };

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  k = 1;
  viewW = 960;
  viewH = VIEW_H;
  camX = 0;
  camY = 0;
  zoom = 1;
  pal: Palette = palette(200);
  particles = new Particles();
  popups: Popup[] = [];
  buildings: Building[] = [];
  stars: { x: number; y: number; z: number }[] = [];
  /** 0..1 pulses */
  beatPulse = 0;
  kick = 0;
  bassAvg = 0.3;
  dropFlash = 0;
  missFlash = 0;
  shake = 0;
  squash = 0;
  time = 0;
  smoothBands = new Float32Array(48);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    for (let i = 0; i < 140; i++) this.stars.push({ x: Math.random(), y: Math.random() * 0.7, z: 0.2 + Math.random() * 0.8 });
    this.setPalette(palette(200), 1);
  }

  setPalette(p: Palette, seed: number) {
    this.pal = p;
    this.buildings = [];
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const layer of [0, 1]) {
      let x = 0;
      while (x < 2400) {
        const w = 40 + r() * (layer ? 80 : 60);
        this.buildings.push({ x, w, band: Math.floor(r() * 40), base: 25 + r() * (layer ? 70 : 120), layer, seed: Math.floor(r() * 1e6) });
        x += w + (layer ? 18 : 6) + r() * 20;
      }
    }
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
    let k = this.canvas.height / VIEW_H;
    if (this.canvas.width / k < 700) k = this.canvas.width / 700;
    k = Math.max(k, this.canvas.height / 760);
    this.k = k;
    this.viewW = this.canvas.width / k;
    this.viewH = this.canvas.height / k;
  }

  // ---------------------------------------------------------------- feedback

  popup(x: number, y: number, text: string, color: string, big = false) {
    this.popups.push({ x, y, text, color, life: 0.8, big });
  }

  grade(g: Grade, x: number, y: number, combo: number) {
    const col = GRADE_COLORS[g];
    this.popup(x, y + 70, g, col, g === 'PERFECT');
    const n = g === 'PERFECT' ? 22 : g === 'GREAT' ? 14 : 8;
    this.particles.burst(x, y + 10, { n, color: [col, '#fff', this.pal.neon], speed: g === 'PERFECT' ? 260 : 160, size: 2.6, life: 0.5, shape: 'star', glow: true });
    this.particles.add({ x, y: y + 10, shape: 'ring', size: 10, life: 0.35, max: 0.35, color: col });
    if (combo > 0 && combo % 25 === 0) {
      this.popup(x, y + 120, `${combo} КОМБО!`, this.pal.accent, true);
      this.dropFlash = Math.max(this.dropFlash, 0.4);
    }
  }

  // ---------------------------------------------------------------- frame update

  update(dt: number, lv: Levels, run: Run | null, chart: Chart | null, songT: number) {
    this.time += dt;
    this.particles.update(dt);
    for (const p of this.popups) {
      p.life -= dt;
      p.y += dt * 60;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (let i = 0; i < 48; i++) this.smoothBands[i] += (lv.bands[i] - this.smoothBands[i]) * Math.min(1, dt * 18);
    this.bassAvg += (lv.bass - this.bassAvg) * Math.min(1, dt * 1.5);
    const kickNow = Math.max(0, lv.bass - this.bassAvg * 0.9) * 3;
    this.kick = Math.max(kickNow, this.kick * Math.exp(-dt * 7));
    if (chart) {
      // pulse that hits exactly on the beat grid
      const beats = chart.beats;
      let lo = 0;
      let hi = beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (beats[mid] <= songT) lo = mid;
        else hi = mid - 1;
      }
      const since = songT - (beats[lo] ?? 0);
      this.beatPulse = songT >= 0 && since >= 0 ? Math.exp(-since * 9) : 0;
    } else {
      this.beatPulse = Math.exp(-((this.time * 2) % 1) * 9);
    }
    this.dropFlash = Math.max(0, this.dropFlash - dt * 1.5);
    this.missFlash = Math.max(0, this.missFlash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 40);
    this.squash *= Math.exp(-dt * 12);
    const targetZoom = 1 + 0.035 * Math.min(1, this.kick) + 0.02 * this.beatPulse;
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 20);

    if (run) {
      this.camX = run.x - this.viewW * 0.3;
      const ty = run.grounded ? run.y : Math.min(run.y, this.camY + 140);
      this.camY += (ty - this.camY) * Math.min(1, dt * 3);
      if (run.ghost > 0 && Math.random() < 0.5) {
        this.particles.add({ x: run.x + (Math.random() - 0.5) * 20, y: run.y + Math.random() * PH, vy: 30, size: 2, color: '#ff4d6d', life: 0.3, max: 0.3, glow: true });
      }
    } else {
      this.camX += dt * 260;
    }
  }

  // ---------------------------------------------------------------- draw

  draw(run: Run | null, chart: Chart | null, songT: number) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const Hs = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky(W, Hs);
    this.drawCity(W, Hs);

    const k = this.k * this.zoom;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake * this.dpr : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake * this.dpr : 0;
    // world (x, y-up) -> screen; the player stays at 30% width, floor at 70% height
    const px = W * 0.3;
    const py = Hs * 0.7;
    const camX = this.camX + this.viewW * 0.3;
    ctx.setTransform(k, 0, 0, -k, px - camX * k + sx, py + this.camY * k + sy);

    if (chart) {
      this.drawFloors(chart, songT);
      this.drawObjects(chart, songT);
    } else {
      this.drawIdleFloor();
    }
    if (run && !run.dead) this.drawTrail(run);
    this.particles.draw(ctx);
    if (run && !run.dead) {
      ctx.save();
      const s = this.toScreen(run.x, run.y, k, px, py, camX, sx, sy);
      ctx.setTransform(k, 0, 0, k, s.x, s.y);
      if (run.ghost > 0 && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.4;
      this.drawPlayer(ctx, run);
      ctx.restore();
    }
    // popups in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of this.popups) {
      const s = this.toScreen(p.x, p.y, k, px, py, camX, sx, sy);
      const a = Math.min(1, p.life * 3);
      const size = (p.big ? 30 : 22) * this.dpr * (1 + (1 - Math.min(1, (0.8 - p.life) * 8)) * 0.4);
      ctx.globalAlpha = a;
      ctx.font = `900 ${size}px "Rubik", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 16 * this.dpr;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, s.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    this.drawPost(W, Hs);
  }

  toScreen(x: number, y: number, k: number, px: number, py: number, camX: number, sx = 0, sy = 0) {
    return { x: px + (x - camX) * k + sx, y: py - (y - this.camY) * k + sy };
  }

  private drawSky(W: number, H: number) {
    const ctx = this.ctx;
    const p = this.pal;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.skyTop);
    g.addColorStop(1, p.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars drift faster when the music is loud
    const speed = 0.01 + this.kick * 0.02;
    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      s.x -= speed * s.z * 0.016;
      if (s.x < 0) s.x += 1;
      ctx.globalAlpha = 0.25 + 0.6 * s.z * (0.6 + 0.4 * Math.sin(this.time * 3 + s.x * 50));
      const r = s.z * 1.6 * this.dpr;
      ctx.fillRect(s.x * W, s.y * H, r, r);
    }
    ctx.globalAlpha = 1;
    // the sun breathes with the bass
    const cx = W * 0.68;
    const cy = H * 0.5;
    const R = H * (0.2 + 0.03 * this.kick + 0.015 * this.beatPulse);
    const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.4);
    glow.addColorStop(0, `hsla(${p.hue + 330}, 100%, 65%, ${0.35 + this.kick * 0.25})`);
    glow.addColorStop(1, `hsla(${p.hue + 330}, 100%, 65%, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    sg.addColorStop(0, `hsl(${p.hue + 50}, 100%, 70%)`);
    sg.addColorStop(1, `hsl(${p.hue + 320}, 100%, 60%)`);
    ctx.fillStyle = sg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.fillStyle = p.skyBot;
    for (let i = 0; i < 9; i++) {
      const yy = cy + R * (0.05 + i * 0.11) + ((this.time * 20) % (R * 0.11));
      ctx.fillRect(cx - R, yy, R * 2, R * 0.012 * (i + 1));
    }
    ctx.restore();
  }

  private drawCity(W: number, H: number) {
    const ctx = this.ctx;
    const p = this.pal;
    const k = this.k;
    const horizon = H * 0.62;
    for (const layer of [0, 1]) {
      const par = layer ? 0.35 : 0.15;
      const off = (this.camX * par) % 2400;
      ctx.fillStyle = layer ? `hsl(${p.hue + 250}, 45%, 11%)` : `hsl(${p.hue + 260}, 40%, 16%)`;
      for (const b of this.buildings) {
        if (b.layer !== layer) continue;
        for (const rep of [0, 2400]) {
          const x = (b.x - off + rep) * k;
          if (x > W || x + b.w * k < -10) continue;
          const lv = this.smoothBands[b.band] ?? 0;
          const h = (b.base + lv * (layer ? 70 : 100)) * k;
          const y = horizon + (layer ? 60 : 0) * k - h;
          ctx.fillRect(x, y, b.w * k, H - y);
          // lit windows
          if (layer === 1) {
            ctx.fillStyle = `hsla(${p.hue + 40}, 100%, 70%, ${0.15 + lv * 0.6})`;
            const cols = Math.floor(b.w / 14);
            for (let c = 0; c < cols; c++) {
              for (let r = 0; r < h / (18 * k); r++) {
                if ((b.seed + c * 7 + r * 13) % 5 > 1) continue;
                ctx.fillRect(x + (4 + c * 14) * k, y + (8 + r * 18) * k, 6 * k, 8 * k);
              }
            }
            ctx.fillStyle = `hsl(${p.hue + 250}, 45%, 11%)`;
          }
          // neon roof line
          ctx.fillStyle = layer ? p.neon : p.neon2;
          ctx.globalAlpha = 0.25 + lv * 0.75;
          ctx.fillRect(x, y, b.w * k, 2 * this.dpr);
          ctx.globalAlpha = 1;
          ctx.fillStyle = layer ? `hsl(${p.hue + 250}, 45%, 11%)` : `hsl(${p.hue + 260}, 40%, 16%)`;
        }
      }
    }
  }

  private drawIdleFloor() {
    const ctx = this.ctx;
    const x0 = this.camX - 200;
    const x1 = this.camX + this.viewW + 400;
    ctx.fillStyle = this.pal.ground;
    ctx.fillRect(x0, -600, x1 - x0, 600);
    ctx.strokeStyle = this.pal.neon;
    ctx.lineWidth = 3;
    ctx.shadowColor = this.pal.neon;
    ctx.shadowBlur = 14 * (0.6 + this.beatPulse);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x1, 0);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let x = Math.floor(x0 / 150) * 150; x < x1; x += 150) {
      ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.12 * this.beatPulse})`;
      ctx.fillRect(x, -600, 2, 600);
    }
  }

  private visible(x0: number, x1: number) {
    return x1 >= this.camX - 100 && x0 <= this.camX + this.viewW / this.zoom + 200;
  }

  private drawFloors(c: Chart, songT: number) {
    const ctx = this.ctx;
    const p = this.pal;
    const deep = -900;
    // ground blocks
    for (const f of c.floors) {
      if (!this.visible(f.x0, f.x1)) continue;
      const g = ctx.createLinearGradient(0, f.y, 0, f.y - 300);
      g.addColorStop(0, p.ground);
      g.addColorStop(1, p.groundDeep);
      ctx.fillStyle = g;
      ctx.fillRect(f.x0, deep, f.x1 - f.x0, f.y - deep);
    }
    // beat lines in the ground: they light up when their beat plays
    const beats = c.beats;
    for (let i = 0; i < beats.length; i++) {
      const x = beats[i] * c.speed;
      if (x < this.camX - 50) continue;
      if (x > this.camX + this.viewW + 200) break;
      const f = c.floors.find((fl) => x >= fl.x0 && x <= fl.x1);
      if (!f) continue;
      const d = songT - beats[i];
      const lit = d >= 0 ? Math.exp(-d * 5) : 0;
      const bar = i % 4 === 0;
      ctx.fillStyle = bar ? p.neon2 : p.neon;
      ctx.globalAlpha = (bar ? 0.22 : 0.1) + lit * 0.7;
      ctx.fillRect(x - (bar ? 1.5 : 1), f.y - 220, bar ? 3 : 2, 220);
      // little dot on the surface
      ctx.globalAlpha = 0.4 + lit * 0.6;
      ctx.fillRect(x - 3, f.y - 3, 6, 3);
    }
    ctx.globalAlpha = 1;
    // neon edges
    ctx.strokeStyle = p.neon;
    ctx.shadowColor = p.neon;
    ctx.shadowBlur = 12 + 18 * Math.max(this.beatPulse, this.kick * 0.8);
    ctx.lineWidth = 3 + 1.5 * this.beatPulse;
    ctx.beginPath();
    for (let i = 0; i < c.floors.length; i++) {
      const f = c.floors[i];
      if (!this.visible(f.x0, f.x1)) continue;
      ctx.moveTo(f.x0, f.y - 260);
      ctx.lineTo(f.x0, f.y);
      ctx.lineTo(f.x1, f.y);
      ctx.lineTo(f.x1, f.y - 260);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // void glow in pits
    for (const pt of c.pits) {
      if (!this.visible(pt.x0, pt.x1)) continue;
      const g = ctx.createLinearGradient(0, pt.y - 40, 0, pt.y - 260);
      g.addColorStop(0, `hsla(${p.hue + 300}, 100%, 60%, 0.18)`);
      g.addColorStop(1, `hsla(${p.hue + 300}, 100%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(pt.x0, pt.y - 260, pt.x1 - pt.x0, 220);
    }
    // finish line
    if (this.visible(c.endX - 20, c.endX + 20)) {
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 ? '#fff' : '#111';
        ctx.fillRect(c.endX, i * 20, 14, 20);
        ctx.fillStyle = i % 2 ? '#111' : '#fff';
        ctx.fillRect(c.endX + 14, i * 20, 14, 20);
      }
    }
  }

  private approach(x: number, y: number, dtTo: number, beatDur: number, color: string) {
    // osu!-style ring that closes exactly when you should press
    if (dtTo < -0.1 || dtTo > beatDur * 2) return;
    const ctx = this.ctx;
    const u = Math.max(0, dtTo / (beatDur * 2));
    const r = 14 + 60 * u;
    ctx.strokeStyle = color;
    ctx.globalAlpha = dtTo < 0 ? Math.max(0, 1 + dtTo * 10) : 0.25 + 0.75 * (1 - u);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawObjects(c: Chart, songT: number) {
    const ctx = this.ctx;
    const p = this.pal;
    const t = this.time;

    // jump markers on the floor
    for (const cu of c.cues) {
      if (cu.kind !== 'jump' || !this.visible(cu.x - 30, cu.x + 30)) continue;
      const dtTo = cu.t - songT;
      const a = cu.judged ? 0.15 : 0.9;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.accent;
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(cu.x - 9, cu.y + 3);
      ctx.lineTo(cu.x, cu.y + 13);
      ctx.lineTo(cu.x + 9, cu.y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (!cu.judged) this.approach(cu.x, cu.y + PH / 2, dtTo, c.beatDur, p.accent);
    }

    // spikes
    for (const s of c.spikes) {
      if (!this.visible(s.x, s.x + s.w)) continue;
      const n = Math.max(1, Math.round(s.w / 13));
      const w = s.w / n;
      ctx.fillStyle = '#12061e';
      ctx.strokeStyle = p.neon2;
      ctx.shadowColor = p.neon2;
      ctx.shadowBlur = 10 + 10 * this.beatPulse;
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x + i * w, s.y);
        ctx.lineTo(s.x + i * w + w / 2, s.y + SPIKE_H * (1 + 0.08 * this.beatPulse));
        ctx.lineTo(s.x + (i + 1) * w, s.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // spiky ceilings hanging from above
    for (const s of c.ceils) {
      if (!this.visible(s.x, s.x + s.w)) continue;
      ctx.fillStyle = '#12061e';
      ctx.fillRect(s.x - 4, s.y + 14, s.w + 8, 600);
      ctx.strokeStyle = p.neon2;
      ctx.shadowColor = p.neon2;
      ctx.shadowBlur = 10 + 10 * this.beatPulse;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x - 4, s.y + 14, s.w + 8, 600);
      const n = Math.max(2, Math.round(s.w / 13));
      const w = s.w / n;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x + i * w, s.y + 14);
        ctx.lineTo(s.x + i * w + w / 2, s.y - (CEIL_H - 34) - 2 * this.beatPulse);
        ctx.lineTo(s.x + (i + 1) * w, s.y + 14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // launch pads
    for (const pd of c.pads) {
      if (!this.visible(pd.x - 30, pd.x + 30)) continue;
      ctx.fillStyle = p.accent;
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = 16;
      ctx.fillRect(pd.x - 18, pd.y, 36, 5);
      for (let i = 0; i < 3; i++) {
        const yy = pd.y + 10 + i * 12 + ((t * 40) % 12);
        ctx.globalAlpha = 1 - i * 0.3;
        ctx.beginPath();
        ctx.moveTo(pd.x - 12, yy);
        ctx.lineTo(pd.x, yy + 9);
        ctx.lineTo(pd.x + 12, yy);
        ctx.lineTo(pd.x + 12, yy + 4);
        ctx.lineTo(pd.x, yy + 13);
        ctx.lineTo(pd.x - 12, yy + 4);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // orbs
    for (const o of c.orbs) {
      if (!this.visible(o.x - 40, o.x + 40)) continue;
      const pulse = 1 + 0.15 * this.beatPulse;
      ctx.globalAlpha = o.used ? 0.25 : 1;
      const oc = o.offbeat ? p.neon2 : p.accent;
      ctx.strokeStyle = oc;
      ctx.shadowColor = oc;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 12 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (!o.used) this.approach(o.x, o.y, o.t - songT, o.offbeat ? c.beatDur / 2 : c.beatDur, o.offbeat ? oc : '#fff');
    }

    // gems
    for (const n of c.notes) {
      if (n.taken || !this.visible(n.x - 20, n.x + 20)) continue;
      const s = 6 + 2 * this.beatPulse;
      ctx.save();
      ctx.translate(n.x, n.y + Math.sin(t * 4 + n.x * 0.01) * 3);
      ctx.rotate(Math.PI / 4 + t);
      ctx.fillStyle = p.neon;
      ctx.shadowColor = p.neon;
      ctx.shadowBlur = 12;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  private drawTrail(run: Run) {
    const ctx = this.ctx;
    const tr = run.trail;
    if (tr.length < 2) return;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = i / tr.length;
      ctx.strokeStyle = run.ghost > 0 ? '#ff4d6d' : this.pal.neon2;
      ctx.globalAlpha = a * 0.5;
      ctx.lineWidth = 2 + a * 10;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x - 6, tr[i - 1].y + PH / 2);
      ctx.lineTo(tr[i].x - 6, tr[i].y + PH / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The hero; drawn in a y-down space with origin at the feet. */
  drawPlayer(ctx: CanvasRenderingContext2D, run: Run | null) {
    const t = this.time;
    const grounded = run ? run.grounded : true;
    const vy = run ? -run.vy : 0;
    let sq = this.squash;
    if (!grounded) sq += Math.max(-0.18, Math.min(0.12, vy / 3000));
    sq -= this.beatPulse * 0.06 * (grounded ? 1 : 0);
    const sx = 1 + sq;
    const sy = 1 - sq;
    const dir = 1;
    const wave = Math.sin(t * 16) * 2.5;
    const lift = grounded ? 0 : Math.max(-6, Math.min(6, vy / 150));
    ctx.strokeStyle = this.pal.neon2;
    ctx.shadowColor = this.pal.neon2;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dir * 6, -12 * sy);
    ctx.quadraticCurveTo(-dir * 14, -12 * sy + wave + lift, -dir * 24, -8 * sy - wave + lift * 1.5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.scale(sx, sy);
    const step = grounded ? Math.sin(t * 24) * 3 : 0;
    ctx.fillStyle = '#5a2a12';
    ctx.beginPath();
    ctx.ellipse(-5 + step, -2, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(5 - step, -2, 4.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.fillStyle = '#ffe0b0';
    ctx.beginPath();
    ctx.ellipse(2, -9, 7, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.pal.neon2;
    ctx.beginPath();
    ctx.roundRect(-12, -15, 24, 4, 2);
    ctx.fill();
    // headphones!
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -22, 14, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = this.pal.neon;
    ctx.beginPath();
    ctx.roundRect(-16, -25, 5, 10, 2);
    ctx.roundRect(11, -25, 5, 10, 2);
    ctx.fill();
    const blink = t % 3.7 < 0.12 ? 0.15 : 1;
    const ex = 3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex - 5, -20, 4, 5 * blink, 0, 0, Math.PI * 2);
    ctx.ellipse(ex + 5, -20, 4, 5 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = '#1b1020';
      ctx.beginPath();
      ctx.arc(ex - 3.4, -20, 2.2, 0, Math.PI * 2);
      ctx.arc(ex + 6.6, -20, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,90,90,0.35)';
    ctx.beginPath();
    ctx.ellipse(ex - 9, -14, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.ellipse(ex + 9, -14, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPost(W: number, H: number) {
    const ctx = this.ctx;
    // edge glow with the bass
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `hsla(${this.pal.hue + 300}, 100%, 55%, ${0.12 + 0.3 * this.kick})`);
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

