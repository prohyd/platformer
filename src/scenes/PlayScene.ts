// Playing a song: feeds presses to the run in sync with the music, reacts to its
// events, handles pause, deaths (back to a checkpoint, or from the start in hardcore),
// the tutorial hints and the end of the song.
import { CONFIG } from '../config.ts';
import type { Game } from '../core/Game.ts';
import type { Command } from '../core/Input.ts';
import type { Scene } from '../core/Scene.ts';
import type { LoadedTrack } from '../data/library.ts';
import type { Track } from '../data/playlist.ts';
import { records } from '../data/records.ts';
import { project, toScreen } from '../render/Camera.ts';
import { PRACTICE } from '../render/palette.ts';
import type { WorldView } from '../render/Renderer.ts';
import { buildChart, hashString } from '../rhythm/generator/buildChart.ts';
import { Run } from '../rhythm/Run.ts';
import type { ScoreState } from '../rhythm/Scorer.ts';
import { xAt } from '../rhythm/speed.ts';
import { chartStats, cpsAround, type ChartStats } from '../rhythm/stats.ts';
import type { Chart, Difficulty, Mode } from '../rhythm/types.ts';
import type { Ui } from '../ui/Ui.ts';
import { pauseButton } from '../ui/widgets.ts';
import { FEEDBACK, type FeedbackTargets } from './play/feedback.ts';
import { drawHud, drawPauseMenu, type DeathInfo } from './play/hud.ts';
import { drawHint, Tutorial, type Hint } from './play/tutorial.ts';
import { ResultsScene } from './ResultsScene.ts';

/** Colour shifts for the parts of a song, by part label (parts that sound alike look alike). */
const SECTION_HUES = [0, 40, -35, 80, -70, 120, 160];

/** Add ?autoplay to the address and the game plays itself (handy to preview a level). */
const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');

/** Where the run goes back to after a death, and the score it had there. */
interface Checkpoint {
  t: number;
  x: number;
  y: number;
  score: ScoreState;
}

export class PlayScene implements Scene {
  private readonly game: Game;
  private readonly track: Track;
  private readonly loaded: LoadedTrack;
  private readonly mode: Mode;
  private readonly difficulty: Difficulty;
  private readonly attempts: number;
  private leadIn: number;
  chart: Chart;
  run: Run;
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
  /** Seconds until the restart (or the checkpoint) after a death (-1 = alive). */
  private deathTimer = -1;
  private death: DeathInfo | null = null;
  private readonly feedback: FeedbackTargets;
  /** Hardcore practice (like in Geometry Dash): checkpoints instead of starting over. */
  private readonly practice: boolean;
  /** Deaths send the run back to the last checkpoint: the «Чекпоинты» mode and hardcore practice. */
  private readonly checkpointed: boolean;
  /** Checkpoints passed so far, in order. */
  private checkpoints: Checkpoint[] = [];
  /** The start of the song, as a checkpoint for deaths before the first real one. */
  private readonly start: Checkpoint;
  private nextPattern = 0;
  /** Song time when the run (re)starts: 0, or a checkpoint. */
  private startT = 0;
  private deaths = 0;
  private readonly tutorial: Tutorial | null;
  /** A tutorial hint is on screen: the game stands still until a press. */
  private hint: Hint | null = null;

  constructor(game: Game, track: Track, loaded: LoadedTrack, attempts: number) {
    this.game = game;
    this.track = track;
    this.loaded = loaded;
    this.mode = game.settings.mode;
    this.difficulty = game.settings.difficulty;
    this.attempts = attempts;
    this.practice = this.mode === 'hardcore' && game.settings.practice;
    this.checkpointed = this.mode === 'flow' || this.practice;
    this.chart = buildChart(loaded.analysis, this.difficulty, hashString(track.id), this.mode);
    this.leadIn = attempts > 1 ? CONFIG.timing.restartLeadIn : CONFIG.timing.leadIn;
    this.run = new Run(this.chart, -this.leadIn);
    this.stats = chartStats(this.chart);
    this.start = { t: 0, x: 0, y: 0, score: this.run.scorer.snapshot() };
    this.tutorial = AUTOPLAY ? null : new Tutorial(this.chart);
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
    if (this.hint && (cmd === 'primary' || cmd === 'tap' || cmd === 'confirm')) this.closeHint();
    else if (cmd === 'primary' || cmd === 'tap') this.press();
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
    if (!this.hint) this.game.audio.resume();
    this.game.input.release();
  }

  /** Stop the song in front of a new kind of obstacle and explain it. */
  private showHint(h: Hint) {
    this.hint = h;
    this.game.audio.pause();
  }

  private closeHint() {
    if (!this.hint) return;
    this.tutorial?.done(this.hint);
    this.hint = null;
    this.game.audio.resume();
    this.game.input.release();
  }

  /** Start the song again (counts as a new attempt in hardcore). */
  private restart() {
    this.game.play(this.track, { attempts: this.mode === 'hardcore' ? this.attempts + 1 : 1 });
  }

  /** Turn hardcore practice on or off. Leaving practice starts the song over, like in GD. */
  private togglePractice() {
    const s = this.game.settings;
    s.practice = !s.practice;
    if (!s.practice) this.game.play(this.track);
    else this.restart();
  }

  /** A checkpoint at the start of a pattern every few seconds. */
  private checkCheckpoints() {
    const pats = this.chart.patterns ?? [];
    const every = this.practice ? CONFIG.timing.checkpointEvery.practice : CONFIG.timing.checkpointEvery.flow;
    while (this.nextPattern < pats.length && pats[this.nextPattern].t <= this.run.t) {
      const t = pats[this.nextPattern++].t;
      const last = this.checkpoints[this.checkpoints.length - 1]?.t ?? this.startT;
      if (t - last < every || this.run.dead) continue;
      const x = xAt(this.chart.speeds, t);
      const floor = this.chart.floors.find((f) => x >= f.x0 && x <= f.x1);
      const y = floor ? floor.y : this.run.y;
      this.checkpoints.push({ t, x, y, score: this.run.scorer.snapshot() });
      this.game.renderer.fx.popup(x, y + 80, '◆ ЧЕКПОИНТ', PRACTICE);
    }
  }

  private get lastCheckpoint() {
    return this.checkpoints[this.checkpoints.length - 1] ?? this.start;
  }

  /** Start again from the last checkpoint (or the start), with the music from the same moment. */
  private respawn() {
    const cp = this.lastCheckpoint;
    const an = this.loaded.analysis;
    const died = this.run.scorer;
    this.chart = buildChart(an, this.difficulty, hashString(this.track.id), this.mode);
    this.run = new Run(this.chart, cp.t);
    this.run.scorer.continueFrom(cp.score, died);
    this.startT = cp.t;
    this.leadIn = CONFIG.timing.restartLeadIn;
    this.deathTimer = -1;
    this.death = null;
    this.presses = [];
    this.nextAutoCue = this.chart.cues.findIndex((q) => q.t >= cp.t - 0.01);
    if (this.nextAutoCue < 0) this.nextAutoCue = this.chart.cues.length;
    this.nextDrop = this.chart.drops.filter((d) => d <= cp.t).length;
    this.nextSection = Math.max(0, this.chart.sections.filter((s) => s.t <= cp.t).length - 1);
    this.nextPattern = (this.chart.patterns ?? []).filter((p) => p.t <= cp.t).length;
    this.game.renderer.camera.y = this.run.y;
    this.game.input.release();
    this.game.audio.play(this.loaded.buffer, this.leadIn, cp.t);
  }

  // ---------------------------------------------------------------- loop

  update(dt: number) {
    this.comboPulse = Math.max(0, this.comboPulse - dt * 4);
    this.songT = this.game.audio.songTime();
    if (this.paused || this.hint) return;
    const hint = this.run.dead ? null : this.tutorial?.due(this.songT);
    if (hint) return this.showHint(hint);

    if (AUTOPLAY) this.autoPress();
    this.presses.sort((a, b) => a - b);
    this.run.update(this.songT, this.presses);
    this.presses = [];
    this.handleEvents();
    this.checkDrops();
    this.checkSections();
    if (this.checkpointed) this.checkCheckpoints();

    if (this.songT > this.chart.duration + 0.4 && !this.run.dead) return this.finish();
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        if (this.checkpointed) this.respawn();
        else this.restart();
      }
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
    this.deaths++;
    const progress = Math.max(0, Math.min(1, this.run.t / this.chart.duration));
    if (!this.checkpointed) {
      const record = records.saveProgress(this.track.id, this.difficulty, progress);
      this.death = { progress, record };
      this.deathTimer = CONFIG.timing.deathPause;
      return;
    }
    // what this mistake costs: the way back and the points won since the checkpoint
    const cp = this.lastCheckpoint;
    this.death = {
      progress,
      record: false,
      checkpoint: { atStart: cp === this.start, lost: this.run.scorer.score - cp.score.score, practice: this.practice },
    };
    this.deathTimer = CONFIG.timing.deathPause * 0.8;
  }

  private finish() {
    const sc = this.run.scorer;
    const best = { score: sc.score, rank: sc.rank, acc: sc.accuracy, combo: sc.maxCombo };
    const record = !this.practice && records.saveFinished(this.track.id, this.difficulty, this.mode, best);
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
        practice: this.practice,
        deaths: this.deaths,
      }),
    );
  }

  // ---------------------------------------------------------------- drawing

  view(): WorldView {
    return { run: this.run, chart: this.chart, songT: this.songT, checkpoints: this.checkpoints };
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
      startT: this.startT,
      practice: this.practice,
      checkpoints: this.checkpoints.length,
      deaths: this.deaths,
    });
    if (this.hint && !this.paused) {
      const r = this.game.renderer;
      const p = toScreen(project(r.camera, r.canvas), this.hint.x, this.hint.y);
      drawHint(ui, this.hint, p.x / r.camera.dpr, p.y / r.camera.dpr);
    }
    pauseButton(ui, () => this.pause());
    if (this.paused) {
      drawPauseMenu(ui, this.game.audio, {
        resume: () => this.resume(),
        restart: () => this.restart(),
        menu: () => this.game.toMenu(),
        practice: this.mode === 'hardcore' ? { on: this.practice, toggle: () => this.togglePractice() } : undefined,
      });
    }
  }
}
