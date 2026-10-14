import { DT, TILE } from '../engine/constants.ts';
import { parseLevel } from '../engine/level.ts';
import { Sim } from '../engine/sim.ts';
import { LEVELS } from '../levels/index.ts';
import { Audio } from './audio.ts';
import { Renderer } from './renderer.ts';
import { loadSave, recordLevel, type SaveData } from './save.ts';
import { THEMES } from './themes.ts';

type Screen = 'title' | 'select' | 'play' | 'pause' | 'complete' | 'victory';

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  action: () => void;
  locked?: boolean;
  primary?: boolean;
  icon?: string;
}

const FONT = '"Rubik", "Segoe UI", system-ui, sans-serif';

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export class Game {
  canvas: HTMLCanvasElement;
  r: Renderer;
  audio = new Audio();
  save: SaveData = loadSave();
  screen: Screen = 'title';
  levelIndex = 0;
  sim: Sim | null = null;
  /** Demo sim shown behind the title screen. */
  demo: Sim;
  acc = 0;
  held = false;
  latched = false;
  levelTime = 0;
  winTimer = -1;
  bannerT = 0;
  bossBanner = 0;
  buttons: Button[] = [];
  hudButtons: Button[] = [];
  focus = 0;
  mouse = { x: -1, y: -1 };
  last = 0;
  selectPage = 0;
  completeStats = { time: 0, deaths: 0, gems: 0, total: 0, record: false };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.r = new Renderer(canvas);
    this.demo = new Sim(parseLevel(LEVELS[0]));
    this.r.setLevel(this.demo);
    this.bindInput();
    window.addEventListener('resize', () => this.r.resize());
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ input

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      this.audio.unlock();
      if (e.repeat) return;
      if (this.screen === 'play') {
        if (e.code === 'Space') {
          if (!this.held) this.latched = true;
          this.held = true;
        } else if (e.code === 'Escape' || e.code === 'KeyP') this.pause();
        else if (e.code === 'KeyM') this.audio.toggleMute();
        return;
      }
      if (e.code === 'KeyM') return this.audio.toggleMute();
      if (e.code === 'Escape') {
        if (this.screen === 'pause') return this.resume();
        if (this.screen === 'select') return this.goTitle();
      }
      const n = this.buttons.length;
      if (!n) return;
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'Tab') {
        e.preventDefault();
        this.focus = (this.focus + 1) % n;
        this.audio.play('click');
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        this.focus = (this.focus - 1 + n) % n;
        this.audio.play('click');
      } else if (e.code === 'Space' || e.code === 'Enter') {
        const b = this.buttons[this.focus];
        if (b && !b.locked) {
          this.audio.play('click');
          b.action();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.held = false;
    });
    window.addEventListener('blur', () => {
      this.held = false;
      if (this.screen === 'play') this.pause();
    });

    const pos = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    this.canvas.addEventListener('pointermove', (e) => {
      this.mouse = pos(e);
      const all = this.screen === 'play' ? this.hudButtons : [...this.buttons, ...this.hudButtons];
      this.canvas.style.cursor = all.some((b) => this.hit(b, this.mouse) && !b.locked) ? 'pointer' : 'default';
      const i = this.buttons.findIndex((b) => this.hit(b, this.mouse));
      if (i >= 0) this.focus = i;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      const p = pos(e);
      this.mouse = p;
      for (const b of this.hudButtons) {
        if (this.hit(b, p)) {
          this.audio.play('click');
          b.action();
          return;
        }
      }
      if (this.screen === 'play') {
        if (!this.held) this.latched = true;
        this.held = true;
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      for (const b of this.buttons) {
        if (this.hit(b, p) && !b.locked) {
          this.audio.play('click');
          b.action();
          return;
        }
      }
    });
    const up = () => {
      this.held = false;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  private hit(b: Button, p: { x: number; y: number }) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  // ------------------------------------------------------------------ flow

  startLevel(i: number) {
    this.levelIndex = i;
    const L = parseLevel(LEVELS[i]);
    this.sim = new Sim(L);
    this.r.setLevel(this.sim);
    this.acc = 0;
    this.levelTime = 0;
    this.winTimer = -1;
    this.bannerT = 0;
    this.bossBanner = 0;
    this.held = false;
    this.latched = false;
    this.screen = 'play';
    this.audio.unlock();
    this.audio.startMusic(THEMES[L.def.theme].music, false);
  }

  pause() {
    if (this.screen !== 'play') return;
    this.screen = 'pause';
    this.focus = 0;
    this.held = false;
  }

  resume() {
    this.screen = 'play';
    this.held = false;
    this.latched = false;
  }

  goTitle() {
    this.screen = 'title';
    this.focus = 0;
    this.audio.stopMusic();
    this.demo = new Sim(parseLevel(LEVELS[0]));
    this.r.setLevel(this.demo);
  }

  goSelect() {
    this.screen = 'select';
    this.focus = Math.min(this.save.unlocked, LEVELS.length - 1) % 10;
    this.selectPage = Math.floor(Math.min(this.save.unlocked, LEVELS.length - 1) / 10);
  }

  private finishLevel() {
    const sim = this.sim!;
    const gems = sim.coinsTaken.reduce((a, b) => a + b, 0);
    const prev = this.save.best[this.levelIndex];
    const record = !prev || this.levelTime < prev.time;
    this.save = recordLevel(this.save, this.levelIndex, { time: this.levelTime, gems, deaths: sim.deaths }, LEVELS.length);
    this.completeStats = { time: this.levelTime, deaths: sim.deaths, gems, total: sim.L.coins.length, record };
    this.screen = this.levelIndex === LEVELS.length - 1 ? 'victory' : 'complete';
    this.focus = 0;
  }

  // ------------------------------------------------------------------ main loop

  private frame(now: number) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;

    if (this.screen === 'play' && this.sim) {
      const sim = this.sim;
      this.acc += dt;
      while (this.acc >= DT) {
        sim.step(this.held || this.latched);
        this.latched = false;
        this.acc -= DT;
        if (!sim.won) this.levelTime += DT;
        for (const ev of sim.events) {
          this.r.effect(ev, sim);
          this.audio.play(ev.t, ev.v ?? 0);
          if (ev.t === 'bossIntro') {
            this.bossBanner = 3;
            this.audio.setBoss(true);
          }
          if (ev.t === 'bossDead') this.audio.setBoss(false);
          if (ev.t === 'respawn' && sim.boss) this.audio.setBoss(false);
          if (ev.t === 'win') this.winTimer = 1.3;
        }
        sim.events.length = 0;
      }
      if (this.winTimer > 0) {
        this.winTimer -= dt;
        if (this.winTimer <= 0) this.finishLevel();
      }
      this.bannerT += dt;
      this.bossBanner = Math.max(0, this.bossBanner - dt);
      this.r.update(dt, sim, this.acc / DT);
    } else if (this.screen === 'title' || this.screen === 'select') {
      this.runDemo(dt);
    } else {
      this.r.update(dt, null, 0);
    }

    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** A tiny autopilot runs level 1 behind the menus. */
  private demoAcc = 0;
  private runDemo(dt: number): void {
    const d = this.demo;
    this.demoAcc += dt;
    while (this.demoAcc >= DT) {
      this.demoAcc -= DT;
      const p = d.p;
      // look ahead for danger: gap, spike or wall
      const ahead = p.x + (p.dir > 0 ? 20 + 26 : -26);
      const tx = Math.floor(ahead / TILE);
      const ty = Math.floor((p.y + 24 + 4) / TILE);
      const floor = d.tileSolid(tx, ty);
      const wall = d.tileSolid(tx, ty - 1);
      const spike = d.L.tiles[(ty - 1) * d.L.w + tx] === 7;
      const want = p.grounded && (!floor || wall || spike);
      d.step(want || (!p.grounded && p.vy < 0 && this.demoHold > 0));
      this.demoHold = want ? 14 : Math.max(0, this.demoHold - 1);
      d.events.length = 0;
      if (d.dead || d.won || d.p.x > 60 * TILE) {
        this.demo = new Sim(d.L);
        this.r.snapCamera(this.demo);
        return this.runDemo(0);
      }
    }
    this.r.update(dt, this.demo, this.demoAcc / DT);
  }
  private demoHold = 0;

  // ------------------------------------------------------------------ drawing

  private draw() {
    const r = this.r;
    const ctx = r.ctx;
    const dpr = r.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    this.buttons = [];
    this.hudButtons = [];

    if (this.screen === 'title' || this.screen === 'select') {
      r.render(this.demo, this.demoAcc / DT);
    } else if (this.sim) {
      r.render(this.sim, this.screen === 'play' ? this.acc / DT : 1);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    switch (this.screen) {
      case 'title':
        this.drawTitle(ctx, W, H);
        break;
      case 'select':
        this.drawSelect(ctx, W, H);
        break;
      case 'play':
        this.drawHud(ctx, W, H);
        break;
      case 'pause':
        this.drawHud(ctx, W, H);
        this.drawPause(ctx, W, H);
        break;
      case 'complete':
        this.drawComplete(ctx, W, H);
        break;
      case 'victory':
        this.drawVictory(ctx, W, H);
        break;
    }
    this.drawSoundButton(ctx, W);
    if (this.screen !== 'play') this.drawButtons(ctx);
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center', weight = 700, outline = true) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size / 6);
      ctx.strokeStyle = 'rgba(20,10,40,0.85)';
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.78) {
    ctx.fillStyle = `rgba(18,12,40,${alpha})`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private dim(ctx: CanvasRenderingContext2D, W: number, H: number, a = 0.45) {
    ctx.fillStyle = `rgba(10,5,25,${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  private drawButtons(ctx: CanvasRenderingContext2D) {
    this.buttons.forEach((b, i) => {
      const focused = i === this.focus;
      const hover = this.hit(b, this.mouse);
      const lift = (focused || hover) && !b.locked ? -2 : 0;
      ctx.save();
      ctx.translate(0, lift);
      ctx.fillStyle = b.locked ? 'rgba(60,55,80,0.85)' : b.primary ? '#ff8a2a' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 14);
      ctx.fill();
      if (b.primary && !b.locked) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.roundRect(b.x + 4, b.y + 3, b.w - 8, b.h / 2 - 3, 10);
        ctx.fill();
      }
      ctx.lineWidth = focused && !b.locked ? 3 : 2;
      ctx.strokeStyle = focused && !b.locked ? '#ffe27a' : 'rgba(255,255,255,0.25)';
      ctx.stroke();
      if (b.icon) {
        this.text(ctx, b.icon, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 10 : 0), b.h * 0.42, b.locked ? '#8a85a0' : '#fff');
      } else {
        this.text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 9 : 0), Math.min(22, b.h * 0.4), b.locked ? '#8a85a0' : '#fff', 'center', 700, false);
      }
      if (b.sub) this.text(ctx, b.sub, b.x + b.w / 2, b.y + b.h / 2 + 14, 12, b.locked ? '#77728c' : '#ffe9c4', 'center', 500, false);
      ctx.restore();
    });
  }

  private drawSoundButton(ctx: CanvasRenderingContext2D, W: number) {
    const s = 40;
    const b: Button = { x: W - s - 14, y: 14, w: s, h: s, label: '', action: () => this.audio.toggleMute() };
    this.hudButtons.push(b);
    ctx.fillStyle = 'rgba(18,12,40,0.6)';
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, s, s, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const cx = b.x + 12;
    const cy = b.y + s / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 4);
    ctx.lineTo(cx, cy - 4);
    ctx.lineTo(cx + 6, cy - 10);
    ctx.lineTo(cx + 6, cy + 10);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();
    if (this.audio.muted) {
      ctx.beginPath();
      ctx.moveTo(cx + 11, cy - 5);
      ctx.lineTo(cx + 19, cy + 5);
      ctx.moveTo(cx + 19, cy - 5);
      ctx.lineTo(cx + 11, cy + 5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + 8, cy, 6, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 8, cy, 11, -0.9, 0.9);
      ctx.stroke();
    }
  }

  private drawTitle(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.dim(ctx, W, H, 0.25);
    const t = this.r.time;
    const big = Math.min(150, W / 5.2);
    const y = H * 0.27;
    // logo with bouncing letters
    const word = 'ПРЫГ!';
    ctx.font = `900 ${big}px ${FONT}`;
    const widths = [...word].map((c) => ctx.measureText(c).width);
    let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
    [...word].forEach((c, i) => {
      const by = y + Math.sin(t * 4 + i * 0.7) * big * 0.06;
      ctx.save();
      ctx.translate(x + widths[i] / 2, by);
      ctx.rotate(Math.sin(t * 3 + i) * 0.05);
      ctx.font = `900 ${big}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = big / 7;
      ctx.strokeStyle = '#2a1350';
      ctx.strokeText(c, 0, big * 0.06);
      ctx.strokeText(c, 0, 0);
      const g = ctx.createLinearGradient(0, -big / 2, 0, big / 2);
      g.addColorStop(0, '#ffe27a');
      g.addColorStop(0.5, '#ffaa3a');
      g.addColorStop(1, '#ff5a3a');
      ctx.fillStyle = g;
      ctx.fillText(c, 0, 0);
      ctx.restore();
      x += widths[i];
    });
    this.text(ctx, 'Одна кнопка. Десять уровней. Один босс.', W / 2, y + big * 0.62, Math.min(24, W / 30), '#fff', 'center', 600);

    const bw = Math.min(300, W - 40);
    const by = H * 0.56;
    const cont = Math.min(this.save.unlocked, LEVELS.length - 1);
    this.buttons.push({
      x: W / 2 - bw / 2,
      y: by,
      w: bw,
      h: 58,
      label: this.save.unlocked > 0 ? `Продолжить · уровень ${cont + 1}` : 'Играть',
      primary: true,
      action: () => this.startLevel(cont),
    });
    this.buttons.push({ x: W / 2 - bw / 2, y: by + 72, w: bw, h: 50, label: 'Выбор уровня', action: () => this.goSelect() });

    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.globalAlpha = pulse;
    this.text(ctx, 'ПРОБЕЛ — прыжок  ·  удерживай — выше', W / 2, H - 70, 18, '#ffe9c4', 'center', 600);
    ctx.globalAlpha = 1;
    this.text(ctx, 'Можно и мышкой / тапом по экрану  ·  M — звук  ·  Esc — пауза', W / 2, H - 42, 13, 'rgba(255,255,255,0.75)', 'center', 500);
  }

  private drawSelect(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.dim(ctx, W, H, 0.5);
    this.text(ctx, 'Выбор уровня', W / 2, 60, 38, '#ffe27a', 'center', 900);
    const page = this.selectPage;
    const count = Math.min(10, LEVELS.length - page * 10);
    const cols = W < 640 ? 2 : 5;
    const rows = Math.ceil(count / cols);
    const gap = 14;
    const cw = Math.min(170, (W - 40 - gap * (cols - 1)) / cols);
    const ch = Math.min(130, (H - 220 - gap * (rows - 1)) / rows);
    const gx = W / 2 - (cols * cw + (cols - 1) * gap) / 2;
    const gy = 110;
    for (let k = 0; k < count; k++) {
      const i = page * 10 + k;
      const def = LEVELS[i];
      const locked = i > this.save.unlocked;
      const best = this.save.best[i];
      const c = k % cols;
      const rr = Math.floor(k / cols);
      const x = gx + c * (cw + gap);
      const y = gy + rr * (ch + gap);
      const total = parseLevel(def).coins.length;
      this.buttons.push({
        x,
        y,
        w: cw,
        h: ch,
        label: '',
        locked,
        action: () => this.startLevel(i),
      });
      // card art
      const th = THEMES[def.theme];
      const g = ctx.createLinearGradient(0, y, 0, y + ch);
      g.addColorStop(0, th.sky[1]);
      g.addColorStop(1, th.sky[2]);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, 14);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = th.mid;
      ctx.beginPath();
      ctx.moveTo(x, y + ch);
      for (let s = 0; s <= 8; s++) ctx.lineTo(x + (cw * s) / 8, y + ch * 0.72 - Math.sin(s * 1.7 + i) * ch * 0.08);
      ctx.lineTo(x + cw, y + ch);
      ctx.fill();
      ctx.fillStyle = th.top;
      ctx.fillRect(x, y + ch - 14, cw, 4);
      ctx.fillStyle = th.ground;
      ctx.fillRect(x, y + ch - 10, cw, 10);
      if (locked) {
        ctx.fillStyle = 'rgba(20,15,35,0.7)';
        ctx.fillRect(x, y, cw, ch);
      }
      ctx.restore();
      const focused = this.buttons.length - 1 === this.focus;
      ctx.lineWidth = focused && !locked ? 3 : 2;
      ctx.strokeStyle = focused && !locked ? '#ffe27a' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, 14);
      ctx.stroke();
      const boss = !!def.boss;
      this.text(ctx, locked ? '🔒' : String(i + 1), x + cw / 2, y + ch * 0.32, ch * 0.3, boss && !locked ? '#ff8c3a' : '#fff', 'center', 900);
      this.text(ctx, boss ? `${def.name} ☠` : def.name, x + cw / 2, y + ch * 0.6, Math.min(14, cw / 11), '#fff', 'center', 700);
      if (best) {
        this.text(ctx, `◆ ${best.gems}/${total}   ⏱ ${fmtTime(best.time)}`, x + cw / 2, y + ch * 0.8, 11, '#bffcff', 'center', 600);
      }
    }
    const bw = 160;
    this.buttons.push({ x: W / 2 - bw / 2, y: H - 80, w: bw, h: 46, label: 'Назад', action: () => this.goTitle() });
    if (LEVELS.length > 10) {
      if (page > 0) this.buttons.push({ x: W / 2 - bw / 2 - 70, y: H - 80, w: 54, h: 46, label: '◀', action: () => this.selectPage-- });
      if ((page + 1) * 10 < LEVELS.length) this.buttons.push({ x: W / 2 + bw / 2 + 16, y: H - 80, w: 54, h: 46, label: '▶', action: () => this.selectPage++ });
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const sim = this.sim!;
    const def = sim.L.def;
    // level plate
    const label = `${this.levelIndex + 1}. ${def.name}`;
    ctx.font = `700 18px ${FONT}`;
    const lw = ctx.measureText(label).width + 28;
    this.panel(ctx, 14, 14, lw, 40, 0.6);
    this.text(ctx, label, 28, 34, 18, '#fff', 'left', 700, false);
    // stats
    const gems = sim.coinsTaken.reduce((a, b) => a + b, 0);
    const stats = `◆ ${gems}/${sim.L.coins.length}    ✖ ${sim.deaths}    ⏱ ${fmtTime(this.levelTime)}`;
    ctx.font = `700 17px ${FONT}`;
    const sw = ctx.measureText(stats).width + 28;
    this.panel(ctx, 14, 60, sw, 36, 0.5);
    this.text(ctx, stats, 28, 78, 17, '#bffcff', 'left', 700, false);

    // pause button
    const pb: Button = { x: W - 40 - 14 - 48, y: 14, w: 40, h: 40, label: '', action: () => this.pause() };
    this.hudButtons.push(pb);
    ctx.fillStyle = 'rgba(18,12,40,0.6)';
    ctx.beginPath();
    ctx.roundRect(pb.x, pb.y, 40, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(pb.x + 13, pb.y + 11, 5, 18);
    ctx.fillRect(pb.x + 22, pb.y + 11, 5, 18);

    // level intro banner
    if (this.bannerT < 3) {
      const a = Math.min(1, this.bannerT * 3, (3 - this.bannerT) * 2);
      ctx.globalAlpha = a;
      const by = H * 0.3 - (1 - Math.min(1, this.bannerT * 3)) * 30;
      this.text(ctx, `Уровень ${this.levelIndex + 1}`, W / 2, by - 34, 24, '#ffe27a', 'center', 800);
      this.text(ctx, def.name, W / 2, by + 10, Math.min(56, W / 12), '#fff', 'center', 900);
      this.text(ctx, THEMES[def.theme].title, W / 2, by + 52, 16, 'rgba(255,255,255,0.8)', 'center', 600);
      ctx.globalAlpha = 1;
    }
    // hint
    if (def.hint && this.bannerT < 9) {
      const a = Math.min(1, (this.bannerT - 0.5) * 2, (9 - this.bannerT) * 1.5);
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.font = `600 17px ${FONT}`;
        const tw = Math.min(W - 40, ctx.measureText(def.hint).width + 40);
        this.panel(ctx, W / 2 - tw / 2, H - 76, tw, 46, 0.7);
        this.text(ctx, def.hint, W / 2, H - 53, tw < ctx.measureText(def.hint).width + 40 ? 13 : 17, '#ffe9c4', 'center', 600, false);
        ctx.globalAlpha = 1;
      }
    }
    // boss
    const b = sim.boss;
    if (b && b.state !== 'idle' && b.state !== 'dead') {
      const bw = Math.min(460, W - 40);
      const x = W / 2 - bw / 2;
      const y = H - 64;
      this.panel(ctx, x - 10, y - 30, bw + 20, 56, 0.7);
      this.text(ctx, b.cfg.name, W / 2, y - 12, 15, '#ffb066', 'center', 800, false);
      ctx.fillStyle = '#2b1a20';
      ctx.beginPath();
      ctx.roundRect(x, y, bw, 14, 7);
      ctx.fill();
      const k = Math.max(0, b.hp / b.cfg.hp);
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      g.addColorStop(0, '#ff3a3a');
      g.addColorStop(1, '#ffb03a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(0.01, bw * k), 14, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      for (let i = 1; i < b.cfg.hp; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (bw * i) / b.cfg.hp, y);
        ctx.lineTo(x + (bw * i) / b.cfg.hp, y + 14);
        ctx.stroke();
      }
    }
    if (this.bossBanner > 0 && b) {
      const a = Math.min(1, this.bossBanner, (3 - this.bossBanner) * 3);
      ctx.globalAlpha = a;
      this.text(ctx, 'БОСС', W / 2, H * 0.28, 30, '#ff8c3a', 'center', 900);
      this.text(ctx, b.cfg.name, W / 2, H * 0.28 + 46, Math.min(52, W / 12), '#fff', 'center', 900);
      ctx.globalAlpha = 1;
    }
  }

  private drawPause(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.dim(ctx, W, H, 0.55);
    const pw = Math.min(360, W - 30);
    const ph = 300;
    const x = W / 2 - pw / 2;
    const y = H / 2 - ph / 2;
    this.panel(ctx, x, y, pw, ph);
    this.text(ctx, 'Пауза', W / 2, y + 48, 40, '#ffe27a', 'center', 900);
    const bw = pw - 60;
    this.buttons.push({ x: W / 2 - bw / 2, y: y + 90, w: bw, h: 52, label: 'Продолжить', primary: true, action: () => this.resume() });
    this.buttons.push({ x: W / 2 - bw / 2, y: y + 154, w: bw, h: 46, label: 'Начать заново', action: () => this.startLevel(this.levelIndex) });
    this.buttons.push({ x: W / 2 - bw / 2, y: y + 212, w: bw, h: 46, label: 'В меню', action: () => this.goTitle() });
  }

  private drawComplete(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.dim(ctx, W, H, 0.5);
    const s = this.completeStats;
    const pw = Math.min(440, W - 30);
    const ph = 380;
    const x = W / 2 - pw / 2;
    const y = H / 2 - ph / 2;
    this.panel(ctx, x, y, pw, ph);
    this.text(ctx, 'Уровень пройден!', W / 2, y + 46, Math.min(36, pw / 12), '#ffe27a', 'center', 900);
    this.text(ctx, LEVELS[this.levelIndex].name, W / 2, y + 84, 18, '#fff', 'center', 600);
    const rows: [string, string][] = [
      ['Время', fmtTime(s.time) + (s.record ? '  ★ рекорд' : '')],
      ['Падений', String(s.deaths)],
      ['Кристаллы', `${s.gems} / ${s.total}`],
    ];
    rows.forEach(([k, v], i) => {
      this.text(ctx, k, x + 40, y + 130 + i * 36, 18, 'rgba(255,255,255,0.75)', 'left', 600, false);
      this.text(ctx, v, x + pw - 40, y + 130 + i * 36, 20, '#bffcff', 'right', 800, false);
    });
    const bw = pw - 60;
    this.buttons.push({ x: W / 2 - bw / 2, y: y + 238, w: bw, h: 54, label: 'Дальше →', sub: 'пробел', primary: true, action: () => this.startLevel(this.levelIndex + 1) });
    const hw = (bw - 12) / 2;
    this.buttons.push({ x: W / 2 - bw / 2, y: y + 304, w: hw, h: 44, label: 'Заново', action: () => this.startLevel(this.levelIndex) });
    this.buttons.push({ x: W / 2 - bw / 2 + hw + 12, y: y + 304, w: hw, h: 44, label: 'Меню', action: () => this.goTitle() });
  }

  private drawVictory(ctx: CanvasRenderingContext2D, W: number, H: number) {
    this.dim(ctx, W, H, 0.55);
    const t = this.r.time;
    if (Math.random() < 0.3) {
      // confetti in world space near the camera
      const r = this.r;
      r.particles.add({ x: r.camX + Math.random() * r.viewW, y: r.camY - 10, vy: 80 + Math.random() * 60, vx: (Math.random() - 0.5) * 40, g: 60, size: 3, shape: 'square', color: ['#ffe27a', '#7df9ff', '#ff6b8b', '#7dff8a'][(Math.random() * 4) | 0], life: 5, max: 5 });
    }
    const totalTime = Object.values(this.save.best).reduce((a, b) => a + b.time, 0);
    const totalGems = Object.values(this.save.best).reduce((a, b) => a + b.gems, 0);
    const allGems = LEVELS.reduce((a, d) => a + parseLevel(d).coins.length, 0);
    this.text(ctx, 'ПОБЕДА!', W / 2, H * 0.24 + Math.sin(t * 3) * 6, Math.min(96, W / 7), '#ffe27a', 'center', 900);
    this.text(ctx, 'Пламенный Страж повержен!', W / 2, H * 0.24 + 70, Math.min(26, W / 22), '#fff', 'center', 700);
    this.text(ctx, `Лучшее время за все уровни: ${fmtTime(totalTime)}`, W / 2, H * 0.24 + 120, 18, '#bffcff', 'center', 600);
    this.text(ctx, `Кристаллы: ${totalGems} / ${allGems}`, W / 2, H * 0.24 + 150, 18, '#bffcff', 'center', 600);
    const bw = Math.min(300, W - 40);
    this.buttons.push({ x: W / 2 - bw / 2, y: H * 0.24 + 200, w: bw, h: 54, label: 'В меню', primary: true, action: () => this.goTitle() });
    this.buttons.push({ x: W / 2 - bw / 2, y: H * 0.24 + 266, w: bw, h: 46, label: 'Сразиться ещё раз', action: () => this.startLevel(this.levelIndex) });
  }
}
