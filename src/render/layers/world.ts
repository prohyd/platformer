// The level itself: floors, beat lines, obstacles, orbs, gems. Drawn in world space (y up).
import { CEIL_H, PH, SPIKE_H } from '../../rhythm/geometry.ts';
import type { Chart } from '../../rhythm/types.ts';
import type { Camera } from '../Camera.ts';
import type { MusicPulse } from '../MusicPulse.ts';
import type { Palette } from '../palette.ts';

/** Everything a world drawing function needs. */
export interface WorldDrawContext {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  pal: Palette;
  pulse: MusicPulse;
  /** Seconds since start, for idle animations. */
  time: number;
}

/** The menu background: an endless neon floor ticking at 120 BPM. */
export function drawIdleFloor({ ctx, cam, pal, pulse }: WorldDrawContext) {
  const x0 = cam.x - 200;
  const x1 = cam.x + cam.viewW + 400;
  ctx.fillStyle = pal.ground;
  ctx.fillRect(x0, -600, x1 - x0, 600);
  ctx.strokeStyle = pal.neon;
  ctx.lineWidth = 3;
  ctx.shadowColor = pal.neon;
  ctx.shadowBlur = 14 * (0.6 + pulse.beatPulse);
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x1, 0);
  ctx.stroke();
  ctx.shadowBlur = 0;
  for (let x = Math.floor(x0 / 150) * 150; x < x1; x += 150) {
    ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.12 * pulse.beatPulse})`;
    ctx.fillRect(x, -600, 2, 600);
  }
}

export function drawLevel(dc: WorldDrawContext, c: Chart, songT: number) {
  drawFloors(dc, c, songT);
  drawJumpMarkers(dc, c, songT);
  drawSpikes(dc, c);
  drawCeilings(dc, c);
  drawPads(dc, c);
  drawOrbs(dc, c, songT);
  drawGems(dc, c);
}

// ---------------------------------------------------------------- floors

function drawFloors({ ctx, cam, pal: p, pulse }: WorldDrawContext, c: Chart, songT: number) {
  const deep = -900;
  // ground blocks
  for (const f of c.floors) {
    if (!cam.visible(f.x0, f.x1)) continue;
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
    if (x < cam.x - 50) continue;
    if (x > cam.x + cam.viewW + 200) break;
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
  ctx.shadowBlur = 12 + 18 * Math.max(pulse.beatPulse, pulse.kick * 0.8);
  ctx.lineWidth = 3 + 1.5 * pulse.beatPulse;
  ctx.beginPath();
  for (const f of c.floors) {
    if (!cam.visible(f.x0, f.x1)) continue;
    ctx.moveTo(f.x0, f.y - 260);
    ctx.lineTo(f.x0, f.y);
    ctx.lineTo(f.x1, f.y);
    ctx.lineTo(f.x1, f.y - 260);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  // void glow in pits
  for (const pt of c.pits) {
    if (!cam.visible(pt.x0, pt.x1)) continue;
    const g = ctx.createLinearGradient(0, pt.y - 40, 0, pt.y - 260);
    g.addColorStop(0, `hsla(${p.hue + 300}, 100%, 60%, 0.18)`);
    g.addColorStop(1, `hsla(${p.hue + 300}, 100%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(pt.x0, pt.y - 260, pt.x1 - pt.x0, 220);
  }
  // finish line
  if (cam.visible(c.endX - 20, c.endX + 20)) {
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#111';
      ctx.fillRect(c.endX, i * 20, 14, 20);
      ctx.fillStyle = i % 2 ? '#111' : '#fff';
      ctx.fillRect(c.endX + 14, i * 20, 14, 20);
    }
  }
}

// ---------------------------------------------------------------- hints

/** osu!-style ring that closes exactly when you should press. */
function approachRing(ctx: CanvasRenderingContext2D, x: number, y: number, dtTo: number, span: number, color: string) {
  if (dtTo < -0.1 || dtTo > span * 2) return;
  const u = Math.max(0, dtTo / (span * 2));
  ctx.strokeStyle = color;
  ctx.globalAlpha = dtTo < 0 ? Math.max(0, 1 + dtTo * 10) : 0.25 + 0.75 * (1 - u);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 14 + 60 * u, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Glowing arrows on the floor where a jump should start. */
function drawJumpMarkers({ ctx, cam, pal: p }: WorldDrawContext, c: Chart, songT: number) {
  for (const cu of c.cues) {
    if (cu.kind !== 'jump' || !cam.visible(cu.x - 30, cu.x + 30)) continue;
    ctx.globalAlpha = cu.judged ? 0.15 : 0.9;
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
    if (!cu.judged) approachRing(ctx, cu.x, cu.y + PH / 2, cu.t - songT, c.beatDur, p.accent);
  }
}

// ---------------------------------------------------------------- hazards

function spikeRow(ctx: CanvasRenderingContext2D, x: number, w: number, baseY: number, tipY: number, minCount: number) {
  const n = Math.max(minCount, Math.round(w / 13));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * sw, baseY);
    ctx.lineTo(x + i * sw + sw / 2, tipY);
    ctx.lineTo(x + (i + 1) * sw, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function hazardStyle(ctx: CanvasRenderingContext2D, p: Palette, pulse: MusicPulse) {
  ctx.fillStyle = '#12061e';
  ctx.strokeStyle = p.neon2;
  ctx.shadowColor = p.neon2;
  ctx.shadowBlur = 10 + 10 * pulse.beatPulse;
  ctx.lineWidth = 2;
}

function drawSpikes({ ctx, cam, pal, pulse }: WorldDrawContext, c: Chart) {
  for (const s of c.spikes) {
    if (!cam.visible(s.x, s.x + s.w)) continue;
    hazardStyle(ctx, pal, pulse);
    spikeRow(ctx, s.x, s.w, s.y, s.y + SPIKE_H * (1 + 0.08 * pulse.beatPulse), 1);
    ctx.shadowBlur = 0;
  }
}

function drawCeilings({ ctx, cam, pal, pulse }: WorldDrawContext, c: Chart) {
  for (const s of c.ceils) {
    if (!cam.visible(s.x, s.x + s.w)) continue;
    ctx.fillStyle = '#12061e';
    ctx.fillRect(s.x - 4, s.y + 14, s.w + 8, 600);
    hazardStyle(ctx, pal, pulse);
    ctx.strokeRect(s.x - 4, s.y + 14, s.w + 8, 600);
    spikeRow(ctx, s.x, s.w, s.y + 14, s.y - (CEIL_H - 34) - 2 * pulse.beatPulse, 2);
    ctx.shadowBlur = 0;
  }
}

// ---------------------------------------------------------------- helpers

function drawPads({ ctx, cam, pal: p, time }: WorldDrawContext, c: Chart) {
  for (const pd of c.pads) {
    if (!cam.visible(pd.x - 30, pd.x + 30)) continue;
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.accent;
    ctx.shadowBlur = 16;
    ctx.fillRect(pd.x - 18, pd.y, 36, 5);
    for (let i = 0; i < 3; i++) {
      const yy = pd.y + 10 + i * 12 + ((time * 40) % 12);
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
}

function drawOrbs({ ctx, cam, pal: p, pulse }: WorldDrawContext, c: Chart, songT: number) {
  for (const o of c.orbs) {
    if (!cam.visible(o.x - 40, o.x + 40)) continue;
    const oc = o.offbeat ? p.neon2 : p.accent;
    ctx.globalAlpha = o.used ? 0.25 : 1;
    ctx.strokeStyle = oc;
    ctx.shadowColor = oc;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 12 * (1 + 0.15 * pulse.beatPulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (!o.used) approachRing(ctx, o.x, o.y, o.t - songT, o.offbeat ? c.beatDur / 2 : c.beatDur, o.offbeat ? oc : '#fff');
  }
}

function drawGems({ ctx, cam, pal: p, pulse, time }: WorldDrawContext, c: Chart) {
  for (const n of c.notes) {
    if (n.taken || !cam.visible(n.x - 20, n.x + 20)) continue;
    const s = 6 + 2 * pulse.beatPulse;
    ctx.save();
    ctx.translate(n.x, n.y + Math.sin(time * 4 + n.x * 0.01) * 3);
    ctx.rotate(Math.PI / 4 + time);
    ctx.fillStyle = p.neon;
    ctx.shadowColor = p.neon;
    ctx.shadowBlur = 12;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
}
