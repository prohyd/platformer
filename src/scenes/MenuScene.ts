// Main menu: mode, difficulty, track list, "add your own track", volume window.
import type { Game } from '../core/Game.ts';
import type { Command } from '../core/Input.ts';
import type { Scene } from '../core/Scene.ts';
import { records } from '../data/records.ts';
import type { Track } from '../data/playlist.ts';
import { DANGER, RANK_COLORS } from '../render/palette.ts';
import type { WorldView } from '../render/Renderer.ts';
import { DIFF_NAMES, MODE_NAMES, type Difficulty, type Mode } from '../rhythm/types.ts';
import type { Rank } from '../rhythm/Scorer.ts';
import type { Ui } from '../ui/Ui.ts';
import { drawLogo, gearButton, volumeControls } from '../ui/widgets.ts';

const ROW_H = 60;
const ROW_GAP = 8;

export class MenuScene implements Scene {
  private readonly game: Game;
  private scroll = 0;
  /** The selection the list was last scrolled to (scroll follows the selection only when it changes). */
  private scrolledTo = -1;
  private showVolume = false;

  constructor(game: Game) {
    this.game = game;
    game.audio.stop();
    game.audio.resume();
  }

  private get tracks() {
    return this.game.library.tracks;
  }

  // ---------------------------------------------------------------- actions

  private select(i: number) {
    this.game.settings.select(i);
    this.game.audio.sound('click');
  }

  private setMode(m: Mode) {
    this.game.settings.setMode(m);
    this.game.audio.sound('click');
  }

  private setDifficulty(d: Difficulty) {
    this.game.settings.setDifficulty(d);
    this.game.audio.sound('click');
  }

  private playSelected() {
    const t = this.tracks[this.game.settings.selected];
    if (t) this.game.play(t);
  }

  // ---------------------------------------------------------------- scene

  update() {}

  view(): WorldView {
    return { run: null, chart: null, songT: 0 };
  }

  onCommand(cmd: Command) {
    const s = this.game.settings;
    if (this.showVolume) {
      if (cmd === 'back' || cmd === 'primary' || cmd === 'confirm') this.showVolume = false;
      return;
    }
    const n = this.tracks.length;
    switch (cmd) {
      case 'down':
        if (n) this.select((s.selected + 1) % n);
        break;
      case 'up':
        if (n) this.select((s.selected - 1 + n) % n);
        break;
      case 'left':
        this.setDifficulty(Math.max(0, s.difficulty - 1) as Difficulty);
        break;
      case 'right':
        this.setDifficulty(Math.min(2, s.difficulty + 1) as Difficulty);
        break;
      case 'primary':
      case 'confirm':
        this.playSelected();
        break;
      case 'openFile':
        this.game.openFilePicker();
        break;
      case 'toggleMode':
        this.setMode(s.mode === 'flow' ? 'hardcore' : 'flow');
        break;
    }
  }

  onWheel(dy: number) {
    this.scroll = Math.max(0, this.scroll + dy);
  }

  // ---------------------------------------------------------------- drawing

  drawUi(ui: Ui) {
    const { W, H } = ui;
    ui.dim(0.35);
    const logo = Math.min(110, W / 6);
    drawLogo(ui, this.game.renderer.pulse, W / 2, 18 + logo * 0.6, logo);
    ui.text('Ритм-раннер на одной кнопке. Прыгай в бит.', W / 2, 30 + logo * 1.2, Math.min(18, W / 34), 'rgba(255,255,255,0.85)', 'center', 600);

    const top = 52 + logo * 1.35;
    const listW = Math.min(620, W - 32);
    const lx = W / 2 - listW / 2;
    this.drawModeSwitch(ui, lx, top, listW);
    const dy = top + 52;
    this.drawDifficulty(ui, lx, dy, listW);
    const ly = dy + 46;
    const listH = Math.max(120, H - ly - 118);
    this.drawTrackList(ui, lx, ly, listW, listH);
    this.drawBottomButtons(ui, lx, ly + listH + 14, listW);
    ui.text('Пробел / клик — прыжок  ·  ↑↓ трек  ·  ←→ сложность  ·  Tab режим  ·  можно перетащить MP3 в окно', W / 2, H - 22, 12, 'rgba(255,255,255,0.6)', 'center', 600);

    if (this.showVolume) this.drawVolumeWindow(ui);
    else gearButton(ui, () => (this.showVolume = true));
  }

  private drawModeSwitch(ui: Ui, x: number, y: number, w: number) {
    const mw = (w - 8) / 2;
    (['flow', 'hardcore'] as Mode[]).forEach((m, i) => {
      const bx = x + i * (mw + 8);
      const active = this.game.settings.mode === m;
      ui.button({ x: bx, y, w: mw, h: 44 }, '', () => this.setMode(m), { active });
      const col = m === 'hardcore' ? DANGER : ui.pal.neon;
      ui.text(MODE_NAMES[m], bx + mw / 2, y + 16, 16, active ? col : '#fff', 'center', 900);
      ui.text(m === 'flow' ? 'ошибки прощаются' : 'смерть — с самого начала', bx + mw / 2, y + 33, 11, 'rgba(255,255,255,0.65)', 'center', 600);
    });
  }

  private drawDifficulty(ui: Ui, x: number, y: number, w: number) {
    const dw = (w - 16) / 3;
    DIFF_NAMES.forEach((name, i) =>
      ui.button({ x: x + i * (dw + 8), y, w: dw, h: 34 }, name, () => this.setDifficulty(i as Difficulty), { active: this.game.settings.difficulty === i }),
    );
  }

  private drawTrackList(ui: Ui, lx: number, ly: number, listW: number, listH: number) {
    const ctx = ui.ctx;
    const sel = this.game.settings.selected;
    // bring a newly selected track into view; otherwise the wheel scrolls freely
    if (this.scrolledTo !== sel) {
      this.scrolledTo = sel;
      const selTop = sel * (ROW_H + ROW_GAP);
      if (selTop - this.scroll < 0) this.scroll = selTop;
      if (selTop + ROW_H - this.scroll > listH) this.scroll = selTop + ROW_H - listH;
    }
    const maxScroll = Math.max(0, this.tracks.length * (ROW_H + ROW_GAP) - listH);
    this.scroll = Math.min(this.scroll, maxScroll);

    ctx.save();
    ctx.beginPath();
    ctx.rect(lx - 4, ly - 4, listW + 8, listH + 8);
    ctx.clip();
    if (!this.tracks.length) ui.text('В папке playlist пока нет треков — загрузи свой ниже', ui.W / 2, ly + 40, 16, '#fff', 'center', 600);
    this.tracks.forEach((t, i) => {
      const y = ly + i * (ROW_H + ROW_GAP) - this.scroll;
      if (y + ROW_H < ly - 4 || y > ly + listH + 4) return;
      this.drawTrackRow(ui, t, i, lx, y, listW, { x: lx, y: Math.max(y, ly), w: listW, h: Math.min(ROW_H, ly + listH - y) });
    });
    ctx.restore();
  }

  private drawTrackRow(ui: Ui, t: Track, i: number, lx: number, y: number, listW: number, hit: { x: number; y: number; w: number; h: number }) {
    const ctx = ui.ctx;
    const { mode, difficulty, selected } = this.game.settings;
    const isSel = i === selected;
    const narrow = ui.W < 760;
    ui.hotspot(hit, () => (isSel ? this.game.play(t) : this.select(i)));
    ui.panel(lx, y, listW, ROW_H, isSel ? 0.75 : ui.hovered(hit) ? 0.6 : 0.45, isSel ? ui.pal.neon : 'rgba(255,255,255,0.1)');
    if (isSel) {
      ctx.fillStyle = ui.pal.neon;
      ctx.fillRect(lx, y + 10, 4, ROW_H - 20);
    }
    ui.text(String(i + 1).padStart(2, '0'), lx + 30, y + ROW_H / 2, 18, isSel ? ui.pal.neon : 'rgba(255,255,255,0.4)', 'center', 900);
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx + 52, y, listW - 52 - (narrow ? 70 : 140), ROW_H);
    ctx.clip();
    ui.text(t.title, lx + 56, y + 23, 18, '#fff', 'left', 800);
    ui.text(t.artist || (t.file ? 'твой трек' : ''), lx + 56, y + 43, 13, 'rgba(255,255,255,0.6)', 'left', 600);
    ctx.restore();

    // best result on the right
    const best = records.get(t.id, difficulty, mode);
    const cy = y + ROW_H / 2;
    if (best && best.done === false) {
      ui.text(`${Math.floor((best.progress ?? 0) * 100)}%`, lx + listW - 34, cy, 18, DANGER, 'center', 900);
    } else if (best) {
      const rc = RANK_COLORS[best.rank as Rank] ?? '#fff';
      ui.text(best.rank, lx + listW - 28, cy, 26, rc, 'center', 900, rc);
      if (!narrow) ui.text(best.score.toLocaleString('ru'), lx + listW - 56, cy, 14, 'rgba(255,255,255,0.75)', 'right', 700);
    } else if (isSel) {
      ui.text('▶', lx + listW - 28, cy, 20, ui.pal.neon, 'center', 900);
    }
  }

  private drawBottomButtons(ui: Ui, lx: number, by: number, listW: number) {
    const half = (listW - 10) / 2;
    const has = this.tracks.length > 0;
    if (has) ui.button({ x: lx, y: by, w: half, h: 46 }, '▶  Играть', () => this.playSelected(), { primary: true });
    ui.button({ x: has ? lx + half + 10 : lx, y: by, w: has ? half : listW, h: 46 }, '＋ Свой трек (MP3)', () => this.game.openFilePicker());
  }

  private drawVolumeWindow(ui: Ui) {
    ui.clearHotspots();
    ui.dim(0.65);
    const pw = Math.min(380, ui.W - 30);
    const x = ui.W / 2 - pw / 2;
    const y = ui.H / 2 - 150;
    ui.panel(x, y, pw, 300, 0.9);
    ui.text('Громкость', ui.W / 2, y + 40, 28, '#fff', 'center', 900, ui.pal.neon);
    volumeControls(ui, this.game.audio, x + 28, y + 76, pw - 56);
    ui.button({ x: x + 28, y: y + 228, w: pw - 56, h: 48 }, 'Готово', () => (this.showVolume = false), { primary: true });
  }
}
