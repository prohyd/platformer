import { analyze, type Analysis } from '../audio/analyze.ts';
import { AudioEngine } from '../audio/engine.ts';
import { PLAYLIST, trackFromName, type Track } from '../playlist.ts';
import { buildChart, DIFF_NAMES, hashString, MODE_NAMES, type Chart, type Difficulty, type Mode } from '../rhythm/chart.ts';
import { Run, type Grade } from '../rhythm/run.ts';
import { palette, Renderer } from './render.ts';
import { getBest, getSetting, saveBest, saveProgress, setSetting, type Best } from './save.ts';

type Screen = 'menu' | 'loading' | 'play' | 'pause' | 'results';

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
  id: string;
}

const FONT = '"Rubik", "Segoe UI", system-ui, sans-serif';
const LEAD = 2.4;
const AUTOPLAY = new URLSearchParams(location.search).has('autoplay');

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Loaded {
  buffer: AudioBuffer;
  analysis: Analysis;
}

export class Game {
  canvas: HTMLCanvasElement;
  r: Renderer;
  audio = new AudioEngine();
  screen: Screen = 'menu';
  tracks: Track[] = [...PLAYLIST];
  sel = 0;
  diff: Difficulty = getSetting<Difficulty>('diff', 1);
  mode: Mode = getSetting<Mode>('mode', 'flow');
  attempts = 1;
  deathTimer = -1;
  death = { progress: 0, record: false };
  cache = new Map<string, Loaded>();
  track: Track | null = null;
  loaded: Loaded | null = null;
  chart: Chart | null = null;
  run: Run | null = null;
  presses: number[] = [];
  held = false;
  loadProgress = 0;
  loadError = '';
  buttons: Button[] = [];
  mouse = { x: -1, y: -1 };
  scroll = 0;
  last = 0;
  dropI = 0;
  autoI = 0;
  result: { best: Best; record: boolean; notes: number; totalNotes: number; attempts: number } | null = null;
  comboPulse = 0;
  fileInput: HTMLInputElement;
  dragging = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.r = new Renderer(canvas);
    this.sel = Math.min(getSetting('sel', 0), Math.max(0, this.tracks.length - 1));
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,.mp3,.ogg,.wav,.m4a,.flac';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) this.addFile(f);
      this.fileInput.value = '';
    });
    this.bindInput();
    window.addEventListener('resize', () => this.r.resize());
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).dbg = { buildChart, Run, analyze, game: this };
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.audio.unlock();
      if (e.repeat) return;
      if (this.screen === 'play') {
        if (e.code === 'Space') this.press();
        else if (e.code === 'Escape' || e.code === 'KeyP') this.pause();
        else if (e.code === 'KeyM') this.audio.toggleMute();
        return;
      }
      if (e.code === 'KeyM') return this.audio.toggleMute();
      if (this.screen === 'menu') {
        const n = this.tracks.length;
        if (e.code === 'ArrowDown' && n) this.select((this.sel + 1) % n);
        else if (e.code === 'ArrowUp' && n) this.select((this.sel - 1 + n) % n);
        else if (e.code === 'ArrowLeft') this.setDiff(Math.max(0, this.diff - 1) as Difficulty);
        else if (e.code === 'ArrowRight') this.setDiff(Math.min(2, this.diff + 1) as Difficulty);
        else if ((e.code === 'Space' || e.code === 'Enter') && n) void this.start(this.tracks[this.sel]);
        else if (e.code === 'KeyO') this.fileInput.click();
        else if (e.code === 'Tab') {
          e.preventDefault();
          this.setMode(this.mode === 'flow' ? 'hardcore' : 'flow');
        }
      } else if (this.screen === 'pause') {
        if (e.code === 'Escape' || e.code === 'Space') this.resume();
      } else if (this.screen === 'results') {
        if (e.code === 'Space' || e.code === 'Enter') void this.start(this.track!);
        else if (e.code === 'Escape') this.toMenu();
        else if (e.code === 'ArrowRight') this.next();
      } else if (this.screen === 'loading' && e.code === 'Escape') {
        this.toMenu();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.held = false;
    });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    const pos = (e: PointerEvent | WheelEvent) => {
      const rc = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rc.left, y: e.clientY - rc.top };
    };
    this.canvas.addEventListener('pointermove', (e) => {
      this.mouse = pos(e);
      this.canvas.style.cursor = this.screen !== 'play' && this.buttons.some((b) => this.hit(b)) ? 'pointer' : 'default';
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      this.mouse = pos(e);
      const b = this.buttons.find((bb) => this.hit(bb));
      if (b) {
        this.audio.sound('click');
        b.action();
        return;
      }
      if (this.screen === 'play') this.press();
    });
    this.canvas.addEventListener('pointerup', () => (this.held = false));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.screen === 'menu') this.scroll = Math.max(0, this.scroll + e.deltaY);
      },
      { passive: true },
    );

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dragging = true;
    });
    window.addEventListener('dragleave', () => (this.dragging = false));
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragging = false;
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        this.audio.unlock();
        this.addFile(f);
      }
    });
  }

  private hit(b: Button) {
    return this.mouse.x >= b.x && this.mouse.x <= b.x + b.w && this.mouse.y >= b.y && this.mouse.y <= b.y + b.h;
  }

  private press() {
    if (!this.run || AUTOPLAY) return;
    if (this.held) return;
    this.held = true;
    this.presses.push(this.audio.songTime());
  }

  private select(i: number) {
    this.sel = i;
    setSetting('sel', i);
    this.audio.sound('click');
  }

  private setMode(m: Mode) {
    this.mode = m;
    setSetting('mode', m);
    this.audio.sound('click');
  }

  private setDiff(d: Difficulty) {
    this.diff = d;
    setSetting('diff', d);
    this.audio.sound('click');
  }

  private addFile(f: File) {
    const id = `file:${f.name}:${f.size}`;
    let t = this.tracks.find((x) => x.id === id);
    if (!t) {
      t = { id, file: f, ...trackFromName(f.name) };
      if (!t.artist) t.artist = 'твой трек';
      this.tracks.push(t);
    }
    this.sel = this.tracks.indexOf(t);
    void this.start(t);
  }

  // ---------------------------------------------------------------- flow

  async start(track: Track, again = false) {
    this.audio.unlock();
    this.audio.stop();
    this.attempts = again ? this.attempts + 1 : 1;
    this.deathTimer = -1;
    this.track = track;
    this.screen = 'loading';
    this.loadProgress = 0;
    this.loadError = '';
    this.r.setPalette(palette(hashString(track.id) % 360), (hashString(track.id) % 100000) + 1);
    try {
      let loaded = this.cache.get(track.id);
      if (!loaded) {
        const data = track.file ? await track.file.arrayBuffer() : await (await fetch(track.url!)).arrayBuffer();
        this.loadProgress = 0.08;
        const buffer = await this.audio.decode(data);
        const analysis = await analyze(buffer, (p) => (this.loadProgress = 0.1 + p * 0.9));
        loaded = { buffer, analysis };
        this.cache.set(track.id, loaded);
      }
      if (this.screen !== 'loading' || this.track !== track) return;
      this.loaded = loaded;
      this.chart = buildChart(loaded.analysis, this.diff, hashString(track.id), this.mode);
      const lead = again ? 1.4 : LEAD;
      this.run = new Run(this.chart, -lead);
      this.presses = [];
      this.dropI = 0;
      this.autoI = 0;
      this.held = false;
      this.r.camY = 0;
      this.audio.play(loaded.buffer, lead);
      this.screen = 'play';
    } catch (err) {
      console.error(err);
      this.loadError = 'Не получилось прочитать этот файл. Попробуй другой MP3.';
    }
  }

  pause() {
    if (this.screen !== 'play') return;
    this.audio.pause();
    this.screen = 'pause';
  }

  resume() {
    if (this.screen !== 'pause') return;
    this.audio.resume();
    this.held = false;
    this.screen = 'play';
  }

  toMenu() {
    this.audio.stop();
    this.audio.resume();
    this.screen = 'menu';
    this.run = null;
    this.chart = null;
  }

  next() {
    if (!this.tracks.length) return;
    this.sel = (this.tracks.indexOf(this.track!) + 1) % this.tracks.length;
    void this.start(this.tracks[this.sel]);
  }

  private finish() {
    const run = this.run!;
    const best: Best = { score: run.score, rank: run.rank, acc: run.accuracy, combo: run.maxCombo };
    const record = saveBest(this.track!.id, this.diff, best, this.mode);
    this.result = { best, record, notes: run.notesTaken, totalNotes: this.chart!.notes.length, attempts: this.attempts };
    this.screen = 'results';
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    const lv = this.audio.readLevels();
    let songT = 0;

    if ((this.screen === 'play' || this.screen === 'pause') && this.run && this.chart) {
      songT = this.audio.songTime();
      if (this.screen === 'play') {
        if (AUTOPLAY) {
          const cues = this.chart.cues;
          while (this.autoI < cues.length && cues[this.autoI].t <= songT) this.presses.push(cues[this.autoI++].t);
        }
        this.presses.sort((a, b) => a - b);
        this.run.update(songT, this.presses);
        this.presses = [];
        this.handleEvents();
        const drops = this.chart.drops;
        while (this.dropI < drops.length && drops[this.dropI] <= songT) {
          this.dropI++;
          this.r.dropFlash = 0.9;
          this.r.shake = 12;
        }
        if (songT > this.chart.duration + 0.4 && !this.run.dead) this.finish();
        if (this.deathTimer > 0) {
          this.deathTimer -= dt;
          if (this.deathTimer <= 0) void this.start(this.track!, true);
        }
      }
    }
    this.comboPulse = Math.max(0, this.comboPulse - dt * 4);
    this.r.update(dt, lv, this.screen === 'play' || this.screen === 'pause' ? this.run : null, this.chart, songT);
    this.draw(songT);
    requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents() {
    const run = this.run!;
    const r = this.r;
    for (const ev of run.events) {
      switch (ev.type) {
        case 'grade':
          r.grade(ev.grade as Grade, ev.x, ev.y, ev.combo ?? 0);
          this.audio.sound(ev.grade!);
          this.comboPulse = 1;
          break;
        case 'miss':
          r.popup(ev.x, ev.y + 70, 'MISS', '#ff4d6d', true);
          r.missFlash = 1;
          r.shake = 10;
          r.particles.burst(ev.x, ev.y + 12, { n: 20, color: ['#ff4d6d', '#fff'], speed: 220, size: 3, life: 0.5, shape: 'square' });
          this.audio.muffle();
          this.audio.sound('miss');
          break;
        case 'death': {
          const progress = Math.max(0, Math.min(1, run.t / this.chart!.duration));
          this.death = { progress, record: saveProgress(this.track!.id, this.diff, progress) };
          this.deathTimer = 1.1;
          r.missFlash = 1.4;
          r.shake = 16;
          r.particles.burst(ev.x, ev.y + 12, { n: 40, color: ['#ff9f43', '#ffd29a', '#ff4d6d', '#fff'], speed: 320, size: 3.5, life: 0.8, shape: 'square' });
          r.particles.add({ x: ev.x, y: ev.y + 12, shape: 'ring', size: 14, life: 0.5, max: 0.5, color: '#fff' });
          this.audio.muffle();
          this.audio.fadeOut(0.5);
          this.audio.sound('miss');
          break;
        }
        case 'jump':
        case 'orb':
          r.squash = -0.3;
          r.particles.burst(ev.x, ev.y + 2, { n: 8, color: [r.pal.neon, '#fff'], speed: 90, angle: -Math.PI / 2, spread: 2.4, size: 2.2, life: 0.35 });
          break;
        case 'land':
          r.squash = 0.25;
          r.particles.burst(ev.x, ev.y + 2, { n: 6, color: [r.pal.neon], speed: 80, angle: Math.PI / 2, spread: 2.6, size: 2, life: 0.3 });
          break;
        case 'pad':
          r.dropFlash = Math.max(r.dropFlash, 0.5);
          r.particles.burst(ev.x, ev.y + 4, { n: 30, color: [r.pal.accent, '#fff', r.pal.neon2], speed: 300, angle: Math.PI / 2, spread: 1.4, size: 3, life: 0.7, glow: true });
          this.audio.sound('pad');
          break;
        case 'note':
          r.particles.burst(ev.x, ev.y, { n: 6, color: [r.pal.neon, '#fff'], speed: 90, size: 2, life: 0.3, glow: true });
          this.audio.sound('note');
          break;
      }
    }
    run.events.length = 0;
  }

  // ---------------------------------------------------------------- drawing

  private text(s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center', weight = 800, glow = '') {
    const ctx = this.r.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.6;
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
  }

  private panel(x: number, y: number, w: number, h: number, a = 0.6, border = 'rgba(255,255,255,0.12)') {
    const ctx = this.r.ctx;
    ctx.fillStyle = `rgba(8,4,20,${a})`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private button(id: string, x: number, y: number, w: number, h: number, label: string, action: () => void, primary = false, active = false) {
    const ctx = this.r.ctx;
    const hov = this.hit({ x, y, w, h, action, id });
    this.buttons.push({ x, y, w, h, action, id });
    const p = this.r.pal;
    ctx.fillStyle = primary ? p.neon2 : active ? 'rgba(255,255,255,0.22)' : hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = active || hov ? p.neon : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.stroke();
    this.text(label, x + w / 2, y + h / 2 + 1, Math.min(18, h * 0.42), primary ? '#14061f' : '#fff', 'center', 800);
  }

  private draw(songT: number) {
    const r = this.r;
    const dpr = r.dpr;
    r.draw(this.screen === 'play' || this.screen === 'pause' ? this.run : null, this.screen === 'menu' ? null : this.chart, songT);
    const ctx = r.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    this.buttons = [];
    switch (this.screen) {
      case 'menu':
        this.drawMenu(W, H);
        break;
      case 'loading':
        this.drawLoading(W, H);
        break;
      case 'play':
        this.drawHud(W, H, songT);
        break;
      case 'pause':
        this.drawHud(W, H, songT);
        this.drawPause(W, H);
        break;
      case 'results':
        this.drawResults(W, H);
        break;
    }
    this.drawSoundButton(W);
    if (this.dragging) {
      ctx.fillStyle = 'rgba(10,0,30,0.7)';
      ctx.fillRect(0, 0, W, H);
      ctx.setLineDash([12, 10]);
      ctx.strokeStyle = r.pal.neon;
      ctx.lineWidth = 3;
      ctx.strokeRect(30, 30, W - 60, H - 60);
      ctx.setLineDash([]);
      this.text('Отпусти файл — уровень построится под твой трек', W / 2, H / 2, 24, '#fff', 'center', 800, r.pal.neon);
    }
  }

  private drawSoundButton(W: number) {
    const ctx = this.r.ctx;
    const x = W - 54;
    const y = 14;
    this.buttons.push({ x, y, w: 40, h: 40, action: () => this.audio.toggleMute(), id: 'mute' });
    this.panel(x, y, 40, 40, 0.5);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const cx = x + 12;
    const cy = y + 20;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 4);
    ctx.lineTo(cx, cy - 4);
    ctx.lineTo(cx + 6, cy - 10);
    ctx.lineTo(cx + 6, cy + 10);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (this.audio.muted) {
      ctx.moveTo(cx + 11, cy - 5);
      ctx.lineTo(cx + 19, cy + 5);
      ctx.moveTo(cx + 19, cy - 5);
      ctx.lineTo(cx + 11, cy + 5);
    } else {
      ctx.arc(cx + 8, cy, 6, -0.9, 0.9);
      ctx.moveTo(cx + 8 + 11 * Math.cos(-0.9), cy + 11 * Math.sin(-0.9));
      ctx.arc(cx + 8, cy, 11, -0.9, 0.9);
    }
    ctx.stroke();
  }

  private drawLogo(x: number, y: number, size: number) {
    const ctx = this.r.ctx;
    const word = 'ПРЫГ!';
    ctx.font = `900 ${size}px ${FONT}`;
    const ws = [...word].map((ch) => ctx.measureText(ch).width);
    let cx = x - ws.reduce((a, b) => a + b, 0) / 2;
    const bands = this.r.smoothBands;
    [...word].forEach((ch, i) => {
      const bounce = Math.max(this.r.beatPulse * 0.6, bands[4 + i * 6] ?? 0) * size * 0.12;
      ctx.save();
      ctx.translate(cx + ws[i] / 2, y - bounce);
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = this.r.pal.neon2;
      ctx.shadowBlur = size * 0.3;
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.5, this.r.pal.neon);
      g.addColorStop(1, this.r.pal.neon2);
      ctx.fillStyle = g;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      cx += ws[i];
    });
  }

  private drawMenu(W: number, H: number) {
    const ctx = this.r.ctx;
    ctx.fillStyle = 'rgba(5,0,15,0.35)';
    ctx.fillRect(0, 0, W, H);
    const narrow = W < 760;
    const logo = Math.min(110, W / 6);
    this.drawLogo(W / 2, 18 + logo * 0.6, logo);
    this.text('Ритм-раннер на одной кнопке. Прыгай в бит.', W / 2, 30 + logo * 1.2, Math.min(18, W / 34), 'rgba(255,255,255,0.85)', 'center', 600);

    const top = 52 + logo * 1.35;
    const listW = Math.min(620, W - 32);
    const lx = W / 2 - listW / 2;
    // mode
    const mw = (listW - 8) / 2;
    (['flow', 'hardcore'] as Mode[]).forEach((m, i) => {
      const sub = m === 'flow' ? 'ошибки прощаются' : 'смерть — с самого начала';
      this.button(`m${m}`, lx + i * (mw + 8), top, mw, 44, '', () => this.setMode(m), false, this.mode === m);
      const col = m === 'hardcore' ? '#ff6b8b' : this.r.pal.neon;
      this.text(MODE_NAMES[m], lx + i * (mw + 8) + mw / 2, top + 16, 16, this.mode === m ? col : '#fff', 'center', 900);
      this.text(sub, lx + i * (mw + 8) + mw / 2, top + 33, 11, 'rgba(255,255,255,0.65)', 'center', 600);
    });
    // difficulty
    const dw = (listW - 16) / 3;
    const dy = top + 52;
    DIFF_NAMES.forEach((name, i) => this.button(`d${i}`, lx + i * (dw + 8), dy, dw, 34, name, () => this.setDiff(i as Difficulty), false, this.diff === i));

    // track list
    const ly = dy + 46;
    const bottomSpace = 118;
    const listH = Math.max(120, H - ly - bottomSpace);
    const rowH = 60;
    const maxScroll = Math.max(0, this.tracks.length * (rowH + 8) - listH);
    this.scroll = Math.min(this.scroll, maxScroll);
    // keep the selection visible
    const selTop = this.sel * (rowH + 8);
    if (selTop - this.scroll < 0) this.scroll = selTop;
    if (selTop + rowH - this.scroll > listH) this.scroll = selTop + rowH - listH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx - 4, ly - 4, listW + 8, listH + 8);
    ctx.clip();
    if (!this.tracks.length) {
      this.text('В папке playlist пока нет треков — загрузи свой ниже', W / 2, ly + 40, 16, '#fff', 'center', 600);
    }
    this.tracks.forEach((t, i) => {
      const y = ly + i * (rowH + 8) - this.scroll;
      if (y + rowH < ly - 4 || y > ly + listH + 4) return;
      const selected = i === this.sel;
      const b: Button = { x: lx, y: Math.max(y, ly), w: listW, h: Math.min(rowH, ly + listH - y), id: `t${i}`, action: () => (this.sel === i ? void this.start(t) : this.select(i)) };
      this.buttons.push(b);
      const hov = this.hit(b);
      this.panel(lx, y, listW, rowH, selected ? 0.75 : hov ? 0.6 : 0.45, selected ? this.r.pal.neon : 'rgba(255,255,255,0.1)');
      if (selected) {
        ctx.fillStyle = this.r.pal.neon;
        ctx.fillRect(lx, y + 10, 4, rowH - 20);
      }
      this.text(String(i + 1).padStart(2, '0'), lx + 30, y + rowH / 2, 18, selected ? this.r.pal.neon : 'rgba(255,255,255,0.4)', 'center', 900);
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx + 52, y, listW - 52 - (narrow ? 70 : 140), rowH);
      ctx.clip();
      this.text(t.title, lx + 56, y + 23, 18, '#fff', 'left', 800);
      this.text(t.artist || (t.file ? 'твой трек' : ''), lx + 56, y + 43, 13, 'rgba(255,255,255,0.6)', 'left', 600);
      ctx.restore();
      const best = getBest(t.id, this.diff, this.mode);
      if (best && best.done === false) {
        this.text(`${Math.floor((best.progress ?? 0) * 100)}%`, lx + listW - 34, y + rowH / 2, 18, '#ff6b8b', 'center', 900);
      } else if (best) {
        const rc = { S: '#ffe27a', A: '#7df9ff', B: '#7dff9a', C: '#ffb066', D: '#ff6b8b' }[best.rank] ?? '#fff';
        this.text(best.rank, lx + listW - 28, y + rowH / 2, 26, rc, 'center', 900, rc);
        if (!narrow) this.text(best.score.toLocaleString('ru'), lx + listW - 56, y + rowH / 2, 14, 'rgba(255,255,255,0.75)', 'right', 700);
      } else if (selected) {
        this.text('▶', lx + listW - 28, y + rowH / 2, 20, this.r.pal.neon, 'center', 900);
      }
    });
    ctx.restore();

    const by = ly + listH + 14;
    const half = (listW - 10) / 2;
    if (this.tracks.length) this.button('play', lx, by, half, 46, '▶  Играть', () => void this.start(this.tracks[this.sel]), true);
    this.button('upload', this.tracks.length ? lx + half + 10 : lx, by, this.tracks.length ? half : listW, 46, '＋ Свой трек (MP3)', () => this.fileInput.click());
    this.text('Пробел / клик — прыжок  ·  ↑↓ трек  ·  ←→ сложность  ·  Tab режим  ·  можно перетащить MP3 в окно', W / 2, H - 22, 12, 'rgba(255,255,255,0.6)', 'center', 600);
  }

  private drawLoading(W: number, H: number) {
    const ctx = this.r.ctx;
    ctx.fillStyle = 'rgba(5,0,15,0.55)';
    ctx.fillRect(0, 0, W, H);
    const t = this.track!;
    this.text(t.title, W / 2, H / 2 - 60, Math.min(40, W / 14), '#fff', 'center', 900, this.r.pal.neon);
    this.text(t.artist, W / 2, H / 2 - 24, 16, 'rgba(255,255,255,0.7)', 'center', 600);
    if (this.loadError) {
      this.text(this.loadError, W / 2, H / 2 + 30, 16, '#ff6b8b', 'center', 700);
      this.button('back', W / 2 - 90, H / 2 + 60, 180, 44, 'Назад', () => this.toMenu());
      return;
    }
    const bw = Math.min(420, W - 60);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, H / 2 + 16, bw, 10, 5);
    ctx.fill();
    ctx.fillStyle = this.r.pal.neon;
    ctx.shadowColor = this.r.pal.neon;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, H / 2 + 16, Math.max(10, bw * this.loadProgress), 10, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    const phase = this.loadProgress < 0.1 ? 'Загружаю трек…' : this.loadProgress < 0.85 ? 'Слушаю бит…' : 'Строю уровень под музыку…';
    this.text(phase, W / 2, H / 2 + 52, 15, 'rgba(255,255,255,0.75)', 'center', 600);
  }

  private drawHud(W: number, H: number, songT: number) {
    const ctx = this.r.ctx;
    const run = this.run!;
    const chart = this.chart!;
    const an = this.loaded!.analysis;
    // progress bar = waveform of the song
    const bx = 16;
    const bw = W - 32 - 64;
    const by = 16;
    const bh = 30;
    this.panel(bx - 4, by - 4, bw + 8, bh + 8, 0.45);
    const prog = Math.max(0, Math.min(1, songT / chart.duration));
    const ov = an.overview;
    const step = bw / ov.length;
    for (let i = 0; i < ov.length; i++) {
      const hh = Math.max(1.5, ov[i] * bh * 0.9);
      const done = i / ov.length < prog;
      ctx.fillStyle = done ? this.r.pal.neon : 'rgba(255,255,255,0.22)';
      ctx.fillRect(bx + i * step, by + bh / 2 - hh / 2, Math.max(1, step - 0.6), hh);
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + bw * prog - 1, by - 2, 2, bh + 4);
    // title + time
    this.text(`${this.track!.title}${this.track!.artist ? ' — ' + this.track!.artist : ''}`, bx, by + bh + 20, 14, 'rgba(255,255,255,0.85)', 'left', 700);
    this.text(`${fmt(Math.max(0, songT))} / ${fmt(chart.duration)}   ·   ${Math.round(60 / chart.beatDur)} BPM   ·   ${MODE_NAMES[this.mode]}, ${DIFF_NAMES[this.diff].toLowerCase()}`, bx, by + bh + 40, 12, 'rgba(255,255,255,0.55)', 'left', 600);
    // score
    this.text(run.score.toLocaleString('ru'), W - 20, by + bh + 26, 26, '#fff', 'right', 900, this.r.pal.neon);
    this.text(`точность ${Math.round(run.accuracy * 100)}%`, W - 20, by + bh + 50, 12, 'rgba(255,255,255,0.6)', 'right', 600);
    if (this.mode === 'hardcore') {
      const best = getBest(this.track!.id, this.diff, 'hardcore');
      const bp = best ? (best.done ? 100 : Math.floor((best.progress ?? 0) * 100)) : 0;
      this.text(`ХАРДКОР · попытка ${this.attempts} · рекорд ${bp}%`, W - 20, by + bh + 70, 12, '#ff6b8b', 'right', 800);
    }
    if (run.dead) {
      ctx.fillStyle = 'rgba(40,0,15,0.35)';
      ctx.fillRect(0, 0, W, H);
      const pct = Math.floor(this.death.progress * 100);
      this.text(`${pct}%`, W / 2, H * 0.42, 96, '#fff', 'center', 900, '#ff4d6d');
      this.text(this.death.record ? '★ Новый рекорд прохождения!' : 'Ещё раз — с самого начала', W / 2, H * 0.42 + 70, 18, this.death.record ? '#ffe27a' : 'rgba(255,255,255,0.85)', 'center', 800);
    }
    // combo
    if (run.combo >= 2) {
      const s = 1 + this.comboPulse * 0.25 + this.r.beatPulse * 0.06;
      ctx.save();
      ctx.translate(W / 2, by + bh + 46);
      ctx.scale(s, s);
      this.text(`${run.combo}`, 0, 0, 40, '#fff', 'center', 900, this.r.pal.neon2);
      this.text('КОМБО', 0, 28, 12, this.r.pal.neon2, 'center', 800);
      ctx.restore();
    }
    // count-in
    if (songT < 0 && !run.dead) {
      const n = Math.ceil(-songT / (LEAD / 3));
      const frac = (-songT / (LEAD / 3)) % 1;
      ctx.globalAlpha = Math.min(1, frac * 3);
      this.text(n > 0 ? String(n) : '', W / 2, H * 0.42, 90 + (1 - frac) * 20, '#fff', 'center', 900, this.r.pal.neon);
      ctx.globalAlpha = 1;
      this.text('Прыгай на светящихся стрелках — когда кольцо сожмётся', W / 2, H * 0.42 + 80, 16, 'rgba(255,255,255,0.85)', 'center', 700);
    }
    this.buttons.push({ x: W - 100, y: 14, w: 40, h: 40, action: () => this.pause(), id: 'pause' });
    this.panel(W - 100, 14, 40, 40, 0.5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(W - 87, 25, 5, 18);
    ctx.fillRect(W - 78, 25, 5, 18);
    if (AUTOPLAY) this.text('AUTOPLAY', W / 2, H - 20, 12, '#ffe27a', 'center', 800);
  }

  private drawPause(W: number, H: number) {
    const ctx = this.r.ctx;
    ctx.fillStyle = 'rgba(5,0,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    const pw = Math.min(340, W - 30);
    const x = W / 2 - pw / 2;
    const y = H / 2 - 130;
    this.panel(x, y, pw, 260, 0.8);
    this.text('Пауза', W / 2, y + 44, 36, '#fff', 'center', 900, this.r.pal.neon);
    this.button('resume', x + 24, y + 84, pw - 48, 48, 'Продолжить', () => this.resume(), true);
    this.button('restart', x + 24, y + 142, pw - 48, 42, 'Заново', () => void this.start(this.track!, this.mode === 'hardcore'));
    this.button('menu', x + 24, y + 194, pw - 48, 42, 'В меню', () => this.toMenu());
  }

  private drawResults(W: number, H: number) {
    const ctx = this.r.ctx;
    const res = this.result!;
    const run = this.run!;
    ctx.fillStyle = 'rgba(5,0,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    const pw = Math.min(480, W - 24);
    const ph = 470;
    const x = W / 2 - pw / 2;
    const y = Math.max(10, H / 2 - ph / 2);
    this.panel(x, y, pw, ph, 0.82);
    this.text(this.track!.title, W / 2, y + 34, 22, '#fff', 'center', 800);
    this.text(`${MODE_NAMES[this.mode]} · ${DIFF_NAMES[this.diff]}${this.mode === 'hardcore' ? ` · пройдено с попытки ${res.attempts}` : ''}`, W / 2, y + 58, 13, this.mode === 'hardcore' ? '#ff6b8b' : 'rgba(255,255,255,0.6)', 'center', 700);
    const rc = { S: '#ffe27a', A: '#7df9ff', B: '#7dff9a', C: '#ffb066', D: '#ff6b8b' }[res.best.rank] ?? '#fff';
    const s = 1 + this.r.beatPulse * 0.05;
    ctx.save();
    ctx.translate(x + 90, y + 150);
    ctx.scale(s, s);
    this.text(res.best.rank, 0, 0, 110, rc, 'center', 900, rc);
    ctx.restore();
    this.text(res.best.score.toLocaleString('ru'), x + pw - 30, y + 118, 34, '#fff', 'right', 900, this.r.pal.neon);
    this.text(`точность ${Math.round(res.best.acc * 100)}%  ·  макс. комбо ${res.best.combo}`, x + pw - 30, y + 152, 13, 'rgba(255,255,255,0.75)', 'right', 600);
    if (res.record) this.text('★ Новый рекорд!', x + pw - 30, y + 180, 15, '#ffe27a', 'right', 800);
    const rows: [string, string, string][] = [
      ['PERFECT', String(run.counts.PERFECT), '#7df9ff'],
      ['GREAT', String(run.counts.GREAT), '#7dff9a'],
      ['GOOD', String(run.counts.GOOD), '#ffe27a'],
      ['MISS', String(run.counts.MISS), '#ff6b8b'],
      ['Кристаллы', `${res.notes} / ${res.totalNotes}`, '#d0b8ff'],
    ];
    rows.forEach(([k, v, c], i) => {
      const ry = y + 232 + i * 30;
      this.text(k, x + 40, ry, 15, c, 'left', 800);
      this.text(v, x + pw - 40, ry, 16, '#fff', 'right', 800);
    });
    const bw = (pw - 60) / 3;
    this.button('again', x + 20, y + ph - 70, bw, 48, 'Ещё раз', () => void this.start(this.track!), true);
    this.button('next', x + 30 + bw, y + ph - 70, bw, 48, 'Следующий', () => this.next());
    this.button('menu', x + 40 + bw * 2, y + ph - 70, bw, 48, 'Меню', () => this.toMenu());
  }
}
