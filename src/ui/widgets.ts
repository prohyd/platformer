// Reusable pieces of UI shared by several scenes.
import type { AudioEngine, VolumeKind } from '../audio/AudioEngine.ts';
import type { MusicPulse } from '../render/MusicPulse.ts';
import { DANGER } from '../render/palette.ts';
import { FONT, type Ui } from './Ui.ts';

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The "ПРЫГ!" logo; each letter bounces with its own part of the spectrum. */
export function drawLogo(ui: Ui, pulse: MusicPulse, x: number, y: number, size: number) {
  const ctx = ui.ctx;
  const word = 'ПРЫГ!';
  ctx.font = `900 ${size}px ${FONT}`;
  const ws = [...word].map((ch) => ctx.measureText(ch).width);
  let cx = x - ws.reduce((a, b) => a + b, 0) / 2;
  [...word].forEach((ch, i) => {
    const bounce = Math.max(pulse.beatPulse * 0.6, pulse.bands[4 + i * 6] ?? 0) * size * 0.12;
    ctx.save();
    ctx.translate(cx + ws[i] / 2, y - bounce);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = ui.pal.neon2;
    ctx.shadowBlur = size * 0.3;
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.5, ui.pal.neon);
    g.addColorStop(1, ui.pal.neon2);
    ctx.fillStyle = g;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cx += ws[i];
  });
}

/** Speaker icon in the top-right corner. */
export function muteButton(ui: Ui, audio: AudioEngine) {
  ui.iconButton(ui.W - 54, 14, () => audio.toggleMute(), (ctx, x, y) => {
    const cx = x - 8;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 4, y - 4);
    ctx.lineTo(cx, y - 4);
    ctx.lineTo(cx + 6, y - 10);
    ctx.lineTo(cx + 6, y + 10);
    ctx.lineTo(cx, y + 4);
    ctx.lineTo(cx - 4, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (audio.muted) {
      ctx.moveTo(cx + 11, y - 5);
      ctx.lineTo(cx + 19, y + 5);
      ctx.moveTo(cx + 19, y - 5);
      ctx.lineTo(cx + 11, y + 5);
    } else {
      ctx.arc(cx + 8, y, 6, -0.9, 0.9);
      ctx.moveTo(cx + 8 + 11 * Math.cos(-0.9), y + 11 * Math.sin(-0.9));
      ctx.arc(cx + 8, y, 11, -0.9, 0.9);
    }
    ctx.stroke();
  });
}

/** Gear icon, left of the speaker. */
export function gearButton(ui: Ui, onClick: () => void) {
  ui.iconButton(ui.W - 100, 14, onClick, (ctx, cx, cy) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 8 : 11;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1030';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Pause icon, left of the speaker. */
export function pauseButton(ui: Ui, onClick: () => void) {
  ui.iconButton(ui.W - 100, 14, onClick, (ctx, cx, cy) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 7, cy - 9, 5, 18);
    ctx.fillRect(cx + 2, cy - 9, 5, 18);
  });
}

const VOLUME_ROWS: [VolumeKind, string][] = [
  ['master', 'Общая громкость'],
  ['music', 'Музыка'],
  ['sfx', 'Эффекты'],
];

/** Three volume sliders, 46 px per row. */
export function volumeControls(ui: Ui, audio: AudioEngine, x: number, y: number, w: number) {
  const p = ui.pal;
  VOLUME_ROWS.forEach(([kind, label], i) => {
    const ry = y + i * 46;
    const muted = kind === 'master' && audio.muted;
    const v = muted ? 0 : audio.volume[kind];
    ui.text(label, x, ry + 8, 13, 'rgba(255,255,255,0.8)', 'left', 700);
    ui.text(muted ? 'выкл' : `${Math.round(v * 100)}%`, x + w, ry + 8, 13, muted ? DANGER : '#fff', 'right', 800);
    const color = kind === 'music' ? p.neon2 : kind === 'sfx' ? p.accent : p.neon;
    ui.slider(`vol-${kind}`, { x, y: ry + 26, w, h: 8 }, v, color, (nv) => audio.setVolume(kind, nv));
  });
}
