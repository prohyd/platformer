// Downloads and analyses the song, then hands over to the play scene.
import type { Game } from '../core/Game.ts';
import type { Command } from '../core/Input.ts';
import type { Scene } from '../core/Scene.ts';
import type { LoadedTrack } from '../data/library.ts';
import type { Track } from '../data/playlist.ts';
import { DANGER, palette } from '../render/palette.ts';
import type { WorldView } from '../render/Renderer.ts';
import { hashString } from '../rhythm/generator/buildChart.ts';
import type { Ui } from '../ui/Ui.ts';
import { PlayScene } from './PlayScene.ts';

export class LoadingScene implements Scene {
  private readonly game: Game;
  private readonly track: Track;
  private readonly attempts: number;
  private progress = 0;
  private error = '';
  private cancelled = false;

  constructor(game: Game, track: Track, attempts: number) {
    this.game = game;
    this.track = track;
    this.attempts = attempts;
    game.audio.unlock();
    game.audio.stop();
    const h = hashString(track.id);
    game.renderer.setPalette(palette(h % 360), (h % 100000) + 1);
    void this.load();
  }

  private async load() {
    try {
      const loaded: LoadedTrack = await this.game.library.load(this.track, (p) => (this.progress = p));
      if (this.cancelled) return;
      this.game.go(new PlayScene(this.game, this.track, loaded, this.attempts));
    } catch (err) {
      console.error(err);
      this.error = 'Не получилось прочитать этот файл. Попробуй другой MP3.';
    }
  }

  update() {}

  view(): WorldView {
    return { run: null, chart: null, songT: 0 };
  }

  onCommand(cmd: Command) {
    if (cmd === 'back') this.game.toMenu();
  }

  exit() {
    this.cancelled = true;
  }

  drawUi(ui: Ui) {
    const { W, H } = ui;
    const ctx = ui.ctx;
    ui.dim(0.55);
    ui.text(this.track.title, W / 2, H / 2 - 60, Math.min(40, W / 14), '#fff', 'center', 900, ui.pal.neon);
    ui.text(this.track.artist, W / 2, H / 2 - 24, 16, 'rgba(255,255,255,0.7)', 'center', 600);
    if (this.error) {
      ui.text(this.error, W / 2, H / 2 + 30, 16, DANGER, 'center', 700);
      ui.button({ x: W / 2 - 90, y: H / 2 + 60, w: 180, h: 44 }, 'Назад', () => this.game.toMenu());
      return;
    }
    const bw = Math.min(420, W - 60);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, H / 2 + 16, bw, 10, 5);
    ctx.fill();
    ctx.fillStyle = ui.pal.neon;
    ctx.shadowColor = ui.pal.neon;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, H / 2 + 16, Math.max(10, bw * this.progress), 10, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    const phase = this.progress < 0.1 ? 'Загружаю трек…' : this.progress < 0.85 ? 'Слушаю бит…' : 'Строю уровень под музыку…';
    ui.text(phase, W / 2, H / 2 + 52, 15, 'rgba(255,255,255,0.75)', 'center', 600);
  }
}
