// Everything drawn on top of the game: song waveform, score, combo, count-in,
// the hardcore death screen and the pause menu.
import type { Analysis } from '../../audio/analyze.ts';
import type { AudioEngine } from '../../audio/AudioEngine.ts';
import type { Track } from '../../data/playlist.ts';
import { DANGER, GOLD } from '../../render/palette.ts';
import type { Run } from '../../rhythm/Run.ts';
import { DIFF_NAMES, MODE_NAMES, type Chart, type Difficulty, type Mode } from '../../rhythm/types.ts';
import type { Ui } from '../../ui/Ui.ts';
import { formatTime, volumeControls } from '../../ui/widgets.ts';

/** Everything the HUD needs to know. */
export interface HudState {
  track: Track;
  chart: Chart;
  analysis: Analysis;
  run: Run;
  songT: number;
  mode: Mode;
  difficulty: Difficulty;
  attempts: number;
  /** Best hardcore reach for this song, 0..100. */
  bestPercent: number;
  /** Set after a hardcore death. */
  death: { progress: number; record: boolean } | null;
  /** Length of the count-in, s. */
  leadIn: number;
  /** 0..1, makes the combo counter jump. */
  comboPulse: number;
  beatPulse: number;
  autoplay: boolean;
}

export function drawHud(ui: Ui, s: HudState) {
  drawProgress(ui, s);
  drawScore(ui, s);
  if (s.death) drawDeath(ui, s.death);
  drawCombo(ui, s);
  if (s.songT < 0 && !s.run.dead) drawCountIn(ui, s);
  if (s.autoplay) ui.text('AUTOPLAY', ui.W / 2, ui.H - 20, 12, GOLD, 'center', 800);
}

/** Progress bar drawn as the song's waveform. */
function drawProgress(ui: Ui, s: HudState) {
  const ctx = ui.ctx;
  const bx = 16;
  const bw = ui.W - 32 - 64;
  const by = 16;
  const bh = 30;
  ui.panel(bx - 4, by - 4, bw + 8, bh + 8, 0.45);
  const prog = Math.max(0, Math.min(1, s.songT / s.chart.duration));
  const ov = s.analysis.overview;
  const step = bw / ov.length;
  for (let i = 0; i < ov.length; i++) {
    const hh = Math.max(1.5, ov[i] * bh * 0.9);
    ctx.fillStyle = i / ov.length < prog ? ui.pal.neon : 'rgba(255,255,255,0.22)';
    ctx.fillRect(bx + i * step, by + bh / 2 - hh / 2, Math.max(1, step - 0.6), hh);
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx + bw * prog - 1, by - 2, 2, bh + 4);
  const t = s.track;
  ui.text(`${t.title}${t.artist ? ' — ' + t.artist : ''}`, bx, by + bh + 20, 14, 'rgba(255,255,255,0.85)', 'left', 700);
  const info = `${formatTime(Math.max(0, s.songT))} / ${formatTime(s.chart.duration)}   ·   ${Math.round(60 / s.chart.beatDur)} BPM   ·   ${MODE_NAMES[s.mode]}, ${DIFF_NAMES[s.difficulty].toLowerCase()}`;
  ui.text(info, bx, by + bh + 40, 12, 'rgba(255,255,255,0.55)', 'left', 600);
}

function drawScore(ui: Ui, s: HudState) {
  const y = 46;
  const sc = s.run.scorer;
  ui.text(sc.score.toLocaleString('ru'), ui.W - 20, y + 26, 26, '#fff', 'right', 900, ui.pal.neon);
  ui.text(`точность ${Math.round(sc.accuracy * 100)}%`, ui.W - 20, y + 50, 12, 'rgba(255,255,255,0.6)', 'right', 600);
  if (s.mode === 'hardcore') ui.text(`ХАРДКОР · попытка ${s.attempts} · рекорд ${s.bestPercent}%`, ui.W - 20, y + 70, 12, DANGER, 'right', 800);
}

function drawCombo(ui: Ui, s: HudState) {
  const combo = s.run.scorer.combo;
  if (combo < 2) return;
  const k = 1 + s.comboPulse * 0.25 + s.beatPulse * 0.06;
  const ctx = ui.ctx;
  ctx.save();
  ctx.translate(ui.W / 2, 92);
  ctx.scale(k, k);
  ui.text(`${combo}`, 0, 0, 40, '#fff', 'center', 900, ui.pal.neon2);
  ui.text('КОМБО', 0, 28, 12, ui.pal.neon2, 'center', 800);
  ctx.restore();
}

function drawCountIn(ui: Ui, s: HudState) {
  const third = s.leadIn / 3;
  const n = Math.ceil(-s.songT / third);
  const frac = (-s.songT / third) % 1;
  ui.ctx.globalAlpha = Math.min(1, frac * 3);
  ui.text(n > 0 ? String(n) : '', ui.W / 2, ui.H * 0.42, 90 + (1 - frac) * 20, '#fff', 'center', 900, ui.pal.neon);
  ui.ctx.globalAlpha = 1;
  ui.text('Прыгай на светящихся стрелках — когда кольцо сожмётся', ui.W / 2, ui.H * 0.42 + 80, 16, 'rgba(255,255,255,0.85)', 'center', 700);
}

/** Hardcore: how far you got. */
function drawDeath(ui: Ui, death: { progress: number; record: boolean }) {
  ui.dim(0.35, '40,0,15');
  ui.text(`${Math.floor(death.progress * 100)}%`, ui.W / 2, ui.H * 0.42, 96, '#fff', 'center', 900, '#ff4d6d');
  const msg = death.record ? '★ Новый рекорд прохождения!' : 'Ещё раз — с самого начала';
  ui.text(msg, ui.W / 2, ui.H * 0.42 + 70, 18, death.record ? GOLD : 'rgba(255,255,255,0.85)', 'center', 800);
}

export interface PauseActions {
  resume(): void;
  restart(): void;
  menu(): void;
}

export function drawPauseMenu(ui: Ui, audio: AudioEngine, a: PauseActions) {
  ui.dim(0.6);
  const pw = Math.min(360, ui.W - 30);
  const x = ui.W / 2 - pw / 2;
  const y = Math.max(8, ui.H / 2 - 205);
  const bw = pw - 48;
  ui.panel(x, y, pw, 410, 0.85);
  ui.text('Пауза', ui.W / 2, y + 44, 36, '#fff', 'center', 900, ui.pal.neon);
  ui.button({ x: x + 24, y: y + 84, w: bw, h: 48 }, 'Продолжить', a.resume, { primary: true });
  ui.button({ x: x + 24, y: y + 142, w: bw, h: 42 }, 'Заново', a.restart);
  ui.button({ x: x + 24, y: y + 194, w: bw, h: 42 }, 'В меню', a.menu);
  volumeControls(ui, audio, x + 24, y + 262, bw);
}
