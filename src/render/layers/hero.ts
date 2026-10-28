// The hero (an orange blob with headphones) and its neon trail.
import { PH } from '../../rhythm/geometry.ts';
import type { Run } from '../../rhythm/Run.ts';
import type { MusicPulse } from '../MusicPulse.ts';
import type { Palette } from '../palette.ts';

/** Trail behind the runner, in world space. */
export function drawTrail(ctx: CanvasRenderingContext2D, run: Run, pal: Palette) {
  const tr = run.trail;
  if (tr.length < 2) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.neon2;
  for (let i = 1; i < tr.length; i++) {
    const a = i / tr.length;
    ctx.globalAlpha = a * 0.5;
    ctx.lineWidth = 2 + a * 10;
    ctx.beginPath();
    ctx.moveTo(tr[i - 1].x - 6, tr[i - 1].y + PH / 2);
    ctx.lineTo(tr[i].x - 6, tr[i].y + PH / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The hero; drawn in a y-down space with the origin at its feet. */
export function drawHero(ctx: CanvasRenderingContext2D, run: Run | null, pal: Palette, pulse: MusicPulse, squash: number, time: number) {
  const t = time;
  const grounded = run ? run.grounded : true;
  const vy = run ? -run.vy : 0;
  let sq = squash;
  if (!grounded) sq += Math.max(-0.18, Math.min(0.12, vy / 3000));
  sq -= pulse.beatPulse * 0.06 * (grounded ? 1 : 0);
  const sx = 1 + sq;
  const sy = 1 - sq;

  // scarf
  const wave = Math.sin(t * 16) * 2.5;
  const lift = grounded ? 0 : Math.max(-6, Math.min(6, vy / 150));
  ctx.strokeStyle = pal.neon2;
  ctx.shadowColor = pal.neon2;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -12 * sy);
  ctx.quadraticCurveTo(-14, -12 * sy + wave + lift, -24, -8 * sy - wave + lift * 1.5);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.scale(sx, sy);

  // feet
  const step = grounded ? Math.sin(t * 24) * 3 : 0;
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
  ctx.fillStyle = '#ffe0b0';
  ctx.beginPath();
  ctx.ellipse(2, -9, 7, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.neon2;
  ctx.beginPath();
  ctx.roundRect(-12, -15, 24, 4, 2);
  ctx.fill();

  // headphones
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -22, 14, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.fillStyle = pal.neon;
  ctx.beginPath();
  ctx.roundRect(-16, -25, 5, 10, 2);
  ctx.roundRect(11, -25, 5, 10, 2);
  ctx.fill();

  // eyes
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
  // cheeks
  ctx.fillStyle = 'rgba(255,90,90,0.35)';
  ctx.beginPath();
  ctx.ellipse(ex - 9, -14, 2.5, 1.5, 0, 0, Math.PI * 2);
  ctx.ellipse(ex + 9, -14, 2.5, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
}
