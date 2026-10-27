// Playing a song: feeds presses to the run in sync with the music, reacts to its
// events, handles pause, hardcore deaths and the end of the song.
import { CONFIG } from '../config.ts';
import type { Game } from '../core/Game.ts';
import type { Command } from '../core/Input.ts';
import type { Scene } from '../core/Scene.ts';
import type { LoadedTrack } from '../data/library.ts';
import type { Track } from '../data/playlist.ts';
import { records } from '../data/records.ts';
import type { WorldView } from '../render/Renderer.ts';
import { buildChart, hashString } from '../rhythm/generator/buildChart.ts';
import { Run } from '../rhythm/Run.ts';
import { chartStats, cpsAround, type ChartStats } from '../rhythm/stats.ts';
import type { Chart, Difficulty, Mode } from '../rhythm/types.ts';
import type { Ui } from '../ui/Ui.ts';
import { pauseButton } from '../ui/widgets.ts';
import { FEEDBACK, type FeedbackTargets } from './play/feedback.ts';
import { drawHud, drawPauseMenu } from './play/hud.ts';
import { ResultsScene } from './ResultsScene.ts';

/** Colour shifts for the parts of a song, by part label (parts that sound alike look alike). */
const SECTION_HUES = [0, 40, -35, 80, -70, 120, 160];

/** Add ?autoplay to the address and the game plays itself (handy to preview a level). */
const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');

export class PlayScene implements Scene {
  private readonly game: Game;
  private readonly track: Track;
  private readonly loaded: LoadedTrack;
  private readonly mode: Mode;
  private readonly difficulty: Difficulty;
  private readonly attempts: number;
  private readonly leadIn: number;
  readonly chart: Chart;
  readonly run: Run;
  readonly stats: ChartStats;
  private readonly baseHue: number;

  private paused = false;
  private songT = 0;
  /** Song times of presses waiting to be fed to the run. */
  private presses: number[] = [];
  private nextDrop = 0;
  private nextSection = 0;
  private nextAutoCue = 0;
  private comboPulse = 0;
  /** Hardcore: seconds until the restart after a death (-1 = alive). */
  private deathTimer = -1;
  private death: { progress: number; record: boolean } | null = null;
  private readonly feedback: FeedbackTargets;

  constructor(game: Game, track: Track, loaded: LoadedTrack, attempts: number) {
    this.game = game;
    this.track = track;
    this.loaded = loaded;
    this.mode = game.settings.mode;
    this.difficulty = game.settings.difficulty;
    this.attempts = attempts;
    this.chart = buildChart(loaded.analysis, this.difficulty, hashString(track.id), this.mode);
    this.leadIn = attempts > 1 ? CONFIG.timing.restartLeadIn : CONFIG.timing.leadIn;
    this.run = new Run(this.chart, -this.leadIn);
    this.stats = chartStats(this.chart);
    this.baseHue = game.renderer.pal.hue;
    this.feedback = {
      fx: game.renderer.fx,
      audio: game.audio,
      pal: game.renderer.pal,
      shake: (a) => (game.renderer.camera.shake = a),
      bumpCombo: () => (this.comboPulse = 1),
    };
    game.renderer.camera.y = 0;
    game.input.release();
    game.audio.play(loaded.buffer, this.leadIn);
  }

  // ---------------------------------------------------------------- controls

  onCommand(cmd: Command) {
    if (this.paused) {
      if (cmd === 'back' || cmd === 'primary') this.resume();
      return;
    }
    if (cmd === 'primary' || cmd === 'tap') this.press();
    else if (cmd === 'back' || cmd === 'pause') this.pause();
  }

  onBlur() {
    this.pause();
  }

  private press() {
    if (!AUTOPLAY) this.presses.push(this.game.audio.songTime());
  }

  private pause() {
    if (this.paused) return;
    this.paused = true;
    this.game.audio.pause();
  }

  private resume() {
    this.paused = false;
    this.game.audio.resume();
    this.game.input.release();
  }

  /** Start the song again (counts as a new attempt in hardcore). */
  private restart() {
    this.game.play(this.track, { attempts: this.mode === 'hardcore' ? this.attempts + 1 : 1 });
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    this.comboPulse = Math.max(0, this.comboPulse - dt * 4);
    this.songT = this.game.audio.songTime();
    if (this.paused) return;

    if (AUTOPLAY) this.autoPress();
    this.presses.sort((a, b) => a - b);
    this.run.update(this.songT, this.presses);
    this.presses = [];
    this.handleEvents();
    this.checkDrops();
    this.checkSections();

    if (this.songT > this.chart.duration + 0.4 && !this.run.dead) return this.finish();
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.restart();
    }
  }

  private autoPress() {
    const cues = this.chart.cues;
    while (this.nextAutoCue < cues.length && cues[this.nextAutoCue].t <= this.songT) this.presses.push(cues[this.nextAutoCue++].t);
  }

  private handleEvents() {
    this.feedback.pal = this.game.renderer.pal;
    for (const ev of this.run.events) {
      FEEDBACK[ev.type](ev, this.feedback);
      if (ev.type === 'death') this.onDeath();
    }
    this.run.events.length = 0;
  }

  /** Flash and shake on the big moments of the song. */
  private checkDrops() {
    const drops = this.chart.drops;
    while (this.nextDrop < drops.length && drops[this.nextDrop] <= this.songT) {
      this.nextDrop++;
      this.game.renderer.fx.dropFlash = 0.9;
      this.game.renderer.camera.shake = CONFIG.feel.shakeOnDrop;
    }
  }

  /** A new part of the song: the colours slide to its own hue. */
  private checkSections() {
    const secs = this.chart.sections;
    while (this.nextSection < secs.length && secs[this.nextSection].t <= this.songT) {
      const sec = secs[this.nextSection++];
      this.game.renderer.shiftHue(this.baseHue + SECTION_HUES[sec.label % SECTION_HUES.length]);
    }
  }

  private onDeath() {
    const progress = Math.max(0, Math.min(1, this.run.t / this.chart.duration));
    this.death = { progress, record: records.saveProgress(this.track.id, this.difficulty, progress) };
    this.deathTimer = CONFIG.timing.deathPause;
  }

  private finish() {
    const sc = this.run.scorer;
    const best = { score: sc.score, rank: sc.rank, acc: sc.accuracy, combo: sc.maxCombo };
    const record = records.saveFinished(this.track.id, this.difficulty, this.mode, best);
    this.game.go(
      new ResultsScene(this.game, {
        track: this.track,
        chart: this.chart,
        scorer: sc,
        best,
        record,
        mode: this.mode,
        difficulty: this.difficulty,
        attempts: this.attempts,
        stats: this.stats,
      }),
    );
  }

  // ---------------------------------------------------------------- drawing

  view(): WorldView {
    return { run: this.run, chart: this.chart, songT: this.songT };
  }

  drawUi(ui: Ui) {
    drawHud(ui, {
      track: this.track,
      chart: this.chart,
      analysis: this.loaded.analysis,
      run: this.run,
      songT: this.songT,
      mode: this.mode,
      difficulty: this.difficulty,
      attempts: this.attempts,
      bestPercent: records.hardcorePercent(this.track.id, this.difficulty),
      death: this.run.dead ? this.death : null,
      leadIn: this.leadIn,
      comboPulse: this.comboPulse,
      beatPulse: this.game.renderer.pulse.beatPulse,
      autoplay: AUTOPLAY,
      stats: this.stats,
      cps: cpsAround(this.chart, this.songT),
    });
    pauseButton(ui, () => this.pause());
    if (this.paused) {
      drawPauseMenu(ui, this.game.audio, {
        resume: () => this.resume(),
        restart: () => this.restart(),
        menu: () => this.game.toMenu(),
      });
    }
  }
}
