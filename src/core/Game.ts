// The application: owns the shared services, runs the main loop and switches scenes.
import { analyze } from '../audio/analyze.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { TrackLibrary } from '../data/library.ts';
import type { Track } from '../data/playlist.ts';
import { Settings } from '../data/settings.ts';
import { Renderer } from '../render/Renderer.ts';
import { buildChart } from '../rhythm/generator/buildChart.ts';
import { Run } from '../rhythm/Run.ts';
import { LoadingScene } from '../scenes/LoadingScene.ts';
import { MenuScene } from '../scenes/MenuScene.ts';
import { Ui } from '../ui/Ui.ts';
import { muteButton } from '../ui/widgets.ts';
import { Input } from './Input.ts';
import type { Scene } from './Scene.ts';

/** Options for starting a song. */
export interface PlayOptions {
  /** Hardcore attempt number (1 = fresh start). */
  attempts?: number;
}

export class Game {
  // ---- shared services, available to every scene
  readonly audio = new AudioEngine();
  readonly settings = new Settings();
  readonly library = new TrackLibrary(this.audio);
  readonly renderer: Renderer;
  readonly ui: Ui;
  readonly input: Input;

  private scene: Scene;
  private readonly fileInput: HTMLInputElement;
  /** A file is being dragged over the window. */
  private draggingFile = false;
  private lastFrame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.ui = new Ui(canvas);
    this.ui.onClick = () => this.audio.sound('click');
    this.ui.onSliderRelease = () => this.audio.sound('PERFECT');
    this.settings.select(Math.min(this.settings.selected, Math.max(0, this.library.tracks.length - 1)));
    this.fileInput = this.createFileInput();
    this.scene = new MenuScene(this);

    this.input = new Input(canvas, {
      command: (cmd) => (cmd === 'mute' ? this.audio.toggleMute() : this.scene.onCommand(cmd)),
      pointerDown: (p) => this.ui.pointerDown(p),
      pointerMove: (p) => {
        this.ui.pointerMove(p);
        canvas.style.cursor = this.ui.overWidget ? 'pointer' : 'default';
      },
      pointerUp: () => this.ui.pointerUp(),
      wheel: (dy) => this.scene.onWheel?.(dy),
      gesture: () => this.audio.unlock(),
      fileDropped: (f) => this.addFile(f),
      dragging: (on) => (this.draggingFile = on),
      blur: () => this.scene.onBlur?.(),
    });
    window.addEventListener('resize', () => this.renderer.resize());

    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).dbg = { buildChart, Run, analyze, game: this };
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- navigation

  /** Switch to another scene. */
  go(scene: Scene) {
    this.scene.exit?.();
    this.scene = scene;
    // buttons of the old scene must not react until the new one is drawn
    this.ui.clearHotspots();
  }

  toMenu() {
    // practice is for one sitting with one song
    this.settings.practice = false;
    this.go(new MenuScene(this));
  }

  /** Load (if needed) and start a song. */
  play(track: Track, opts: PlayOptions = {}) {
    this.go(new LoadingScene(this, track, opts.attempts ?? 1));
  }

  openFilePicker() {
    this.fileInput.click();
  }

  /** A file from the picker or drag & drop: add it to the list and play it. */
  addFile(f: File) {
    const track = this.library.addFile(f);
    this.settings.select(this.library.indexOf(track));
    this.play(track);
  }

  private createFileInput() {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'audio/*,.mp3,.ogg,.wav,.m4a,.flac';
    el.style.display = 'none';
    document.body.appendChild(el);
    el.addEventListener('change', () => {
      const f = el.files?.[0];
      if (f) this.addFile(f);
      el.value = '';
    });
    return el;
  }

  // ---------------------------------------------------------------- main loop

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    const scene = this.scene;
    scene.update(dt);

    // the scene may have switched during update; draw whatever is current now
    const current = this.scene;
    const view = current.view();
    this.renderer.update(dt, this.audio.readLevels(), view);
    this.renderer.draw(view);

    const ui = this.ui;
    ui.begin(this.renderer.camera.dpr, this.renderer.pal);
    current.drawUi(ui);
    muteButton(ui, this.audio);
    if (this.draggingFile) this.drawDropHint();
    requestAnimationFrame((t) => this.frame(t));
  }

  private drawDropHint() {
    const ui = this.ui;
    const ctx = ui.ctx;
    ui.dim(0.7, '10,0,30');
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = ui.pal.neon;
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, ui.W - 60, ui.H - 60);
    ctx.setLineDash([]);
    ui.text('Отпусти файл — уровень построится под твой трек', ui.W / 2, ui.H / 2, 24, '#fff', 'center', 800, ui.pal.neon);
  }
}
