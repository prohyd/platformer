// The sky: stars, a breathing synthwave sun and a city whose buildings are a spectrum analyser.
import type { Camera } from '../Camera.ts';
import type { MusicPulse } from '../MusicPulse.ts';
import type { Palette } from '../palette.ts';

interface Building {
  x: number;
  w: number;
  /** Which spectrum band makes it grow. */
  band: number;
  base: number;
  /** 0 = far, 1 = near. */
  layer: number;
  seed: number;
}

const CITY_WIDTH = 2400;

export class Background {
  private buildings: Building[] = [];
  private readonly stars: { x: number; y: number; z: number }[] = [];

  constructor() {
    for (let i = 0; i < 140; i++) this.stars.push({ x: Math.random(), y: Math.random() * 0.7, z: 0.2 + Math.random() * 0.8 });
    this.generateCity(1);
  }

  /** A new skyline for a new song. */
  generateCity(seed: number) {
    this.buildings = [];
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const layer of [0, 1]) {
      let x = 0;
      while (x < CITY_WIDTH) {
        const w = 40 + r() * (layer ? 80 : 60);
        this.buildings.push({ x, w, band: Math.floor(r() * 40), base: 25 + r() * (layer ? 70 : 120), layer, seed: Math.floor(r() * 1e6) });
        x += w + (layer ? 18 : 6) + r() * 20;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Camera, pal: Palette, pulse: MusicPulse, time: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky(ctx, W, H, cam, pal, pulse, time);
    this.drawCity(ctx, W, H, cam, pal, pulse);
  }

  private drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Camera, p: Palette, pulse: MusicPulse, time: number) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.skyTop);
    g.addColorStop(1, p.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // stars drift faster when the music is loud
    const speed = 0.01 + pulse.kick * 0.02;
    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      s.x -= speed * s.z * 0.016;
      if (s.x < 0) s.x += 1;
      ctx.globalAlpha = 0.25 + 0.6 * s.z * (0.6 + 0.4 * Math.sin(time * 3 + s.x * 50));
      const r = s.z * 1.6 * cam.dpr;
      ctx.fillRect(s.x * W, s.y * H, r, r);
    }
    ctx.globalAlpha = 1;
    // the sun breathes with the bass
    const cx = W * 0.68;
    const cy = H * 0.5;
    const R = H * (0.2 + 0.03 * pulse.kick + 0.015 * pulse.beatPulse);
    const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.4);
    glow.addColorStop(0, `hsla(${p.hue + 330}, 100%, 65%, ${0.35 + pulse.kick * 0.25})`);
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
      const yy = cy + R * (0.05 + i * 0.11) + ((time * 20) % (R * 0.11));
      ctx.fillRect(cx - R, yy, R * 2, R * 0.012 * (i + 1));
    }
    ctx.restore();
  }

  private drawCity(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Camera, p: Palette, pulse: MusicPulse) {
    const k = cam.k;
    const horizon = H * 0.62;
    for (const layer of [0, 1]) {
      const par = layer ? 0.35 : 0.15;
      const off = (cam.x * par) % CITY_WIDTH;
      const body = layer ? `hsl(${p.hue + 250}, 45%, 11%)` : `hsl(${p.hue + 260}, 40%, 16%)`;
      for (const b of this.buildings) {
        if (b.layer !== layer) continue;
        for (const rep of [0, CITY_WIDTH]) {
          const x = (b.x - off + rep) * k;
          if (x > W || x + b.w * k < -10) continue;
          const lv = pulse.bands[b.band] ?? 0;
          const h = (b.base + lv * (layer ? 70 : 100)) * k;
          const y = horizon + (layer ? 60 : 0) * k - h;
          ctx.fillStyle = body;
          ctx.fillRect(x, y, b.w * k, H - y);
          if (layer === 1) {
            // lit windows
            ctx.fillStyle = `hsla(${p.hue + 40}, 100%, 70%, ${0.15 + lv * 0.6})`;
            const cols = Math.floor(b.w / 14);
            for (let c = 0; c < cols; c++) {
              for (let r = 0; r < h / (18 * k); r++) {
                if ((b.seed + c * 7 + r * 13) % 5 > 1) continue;
                ctx.fillRect(x + (4 + c * 14) * k, y + (8 + r * 18) * k, 6 * k, 8 * k);
              }
            }
          }
          // neon roof line
          ctx.fillStyle = layer ? p.neon : p.neon2;
          ctx.globalAlpha = 0.25 + lv * 0.75;
          ctx.fillRect(x, y, b.w * k, 2 * cam.dpr);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}
