// End of a song: rank, score, accuracy and buttons for what's next.
import type { Game } from '../core/Game.ts';
import type { Command } from '../core/Input.ts';
import type { Scene } from '../core/Scene.ts';
import type { Track } from '../data/playlist.ts';
import type { Best } from '../data/records.ts';
import { DANGER, GOLD, GRADE_COLORS, RANK_COLORS } from '../render/palette.ts';
import type { WorldView } from '../render/Renderer.ts';
import type { Rank, Scorer } from '../rhythm/Scorer.ts';
import type { ChartStats } from '../rhythm/stats.ts';
import { DIFF_NAMES, MODE_NAMES, type Chart, type Difficulty, type Mode } from '../rhythm/types.ts';
import type { Ui } from '../ui/Ui.ts';

export interface ResultsData {
  track: Track;
  chart: Chart;
  scorer: Scorer;
  best: Best;
  record: boolean;
  mode: Mode;
  difficulty: Difficulty;
  attempts: number;
  stats: ChartStats;
}

export class ResultsScene implements Scene {
  private readonly game: Game;
  private readonly r: ResultsData;

  constructor(game: Game, data: ResultsData) {
    this.game = game;
    this.r = data;
  }

  private again() {
    this.game.play(this.r.track);
  }

  private next() {
    const lib = this.game.library;
    if (!lib.tracks.length) return;
    const t = lib.next(this.r.track);
    this.game.settings.select(lib.indexOf(t));
    this.game.play(t);
  }

  update() {}

  /** The finished level stays in the background. */
  view(): WorldView {
    return { run: null, chart: this.r.chart, songT: 0 };
  }

  onCommand(cmd: Command) {
    if (cmd === 'primary' || cmd === 'confirm') this.again();
    else if (cmd === 'back') this.game.toMenu();
    else if (cmd === 'right') this.next();
  }

  drawUi(ui: Ui) {
    const { W, H } = ui;
    const { track, scorer, best, record, mode, difficulty, attempts, chart, stats } = this.r;
    ui.dim(0.6);
    const pw = Math.min(480, W - 24);
    const ph = 500;
    const x = W / 2 - pw / 2;
    const y = Math.max(10, H / 2 - ph / 2);
    ui.panel(x, y, pw, ph, 0.82);
    ui.text(track.title, W / 2, y + 34, 22, '#fff', 'center', 800);
    const sub = `${MODE_NAMES[mode]} · ${DIFF_NAMES[difficulty]}${mode === 'hardcore' ? ` · пройдено с попытки ${attempts}` : ''}`;
    ui.text(sub, W / 2, y + 58, 13, mode === 'hardcore' ? DANGER : 'rgba(255,255,255,0.6)', 'center', 700);

    // big rank letter, pulsing with the beat
    const rc = RANK_COLORS[best.rank as Rank] ?? '#fff';
    const k = 1 + this.game.renderer.pulse.beatPulse * 0.05;
    ui.ctx.save();
    ui.ctx.translate(x + 90, y + 150);
    ui.ctx.scale(k, k);
    ui.text(best.rank, 0, 0, 110, rc, 'center', 900, rc);
    ui.ctx.restore();

    ui.text(best.score.toLocaleString('ru'), x + pw - 30, y + 118, 34, '#fff', 'right', 900, ui.pal.neon);
    ui.text(`точность ${Math.round(best.acc * 100)}%  ·  макс. комбо ${best.combo}`, x + pw - 30, y + 152, 13, 'rgba(255,255,255,0.75)', 'right', 600);
    if (record) ui.text('★ Новый рекорд!', x + pw - 30, y + 180, 15, GOLD, 'right', 800);

    const rows: [string, string, string][] = [
      ['PERFECT', String(scorer.counts.PERFECT), GRADE_COLORS.PERFECT],
      ['GREAT', String(scorer.counts.GREAT), GRADE_COLORS.GREAT],
      ['GOOD', String(scorer.counts.GOOD), GRADE_COLORS.GOOD],
      ['MISS', String(scorer.counts.MISS), DANGER],
      ['Кристаллы', `${scorer.notesTaken} / ${chart.notes.length}`, '#d0b8ff'],
      [`Уровень: ${stats.rating}`, `${stats.avgCps.toFixed(1)} · пик ${stats.peakCps.toFixed(1)} клик/с`, '#9fe8ff'],
    ];
    rows.forEach(([label, value, color], i) => {
      const ry = y + 232 + i * 30;
      ui.text(label, x + 40, ry, 15, color, 'left', 800);
      ui.text(value, x + pw - 40, ry, 16, '#fff', 'right', 800);
    });

    const bw = (pw - 60) / 3;
    const by = y + ph - 70;
    ui.button({ x: x + 20, y: by, w: bw, h: 48 }, 'Ещё раз', () => this.again(), { primary: true });
    ui.button({ x: x + 30 + bw, y: by, w: bw, h: 48 }, 'Следующий', () => this.next());
    ui.button({ x: x + 40 + bw * 2, y: by, w: bw, h: 48 }, 'Меню', () => this.game.toMenu());
  }
}
