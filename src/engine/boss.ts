import { DT, GRAVITY, PLAYER_W, RUN_SPEED, TILE } from './constants.ts';
import { ALT, DOOR, SOLID, type LevelData } from './level.ts';
import type { BossConfig } from './types.ts';

export type BossStateName = 'idle' | 'intro' | 'hover' | 'windup' | 'slam' | 'stunned' | 'rise' | 'throw' | 'dying' | 'dead';

export interface Wave {
  x: number;
  dir: number;
}

export interface Roller {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  rot: number;
  onFloor: boolean;
}

export const BOSS_W = 96;
export const BOSS_H = 80;
export const ROLLER_R = 12;
export const WAVE_W = 16;
export const WAVE_H = 22;

type Emit = (t: string, x: number, y: number, v?: number) => void;

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * The boss: hovers over the arena, alternates between a ground slam (after which it
 * is stunned and its head can be stomped) and a volley of rolling spike balls.
 * Fully deterministic so the level solver can simulate it.
 */
export class Boss {
  cfg: BossConfig;
  hp: number;
  x = 0;
  y = 0;
  vy = 0;
  state: BossStateName = 'idle';
  t = 0;
  flash = 0;
  next: 'slam' | 'throw' = 'slam';
  thrown = 0;
  /** Where the boss flies to before the next slam (left x). */
  targetX = 0;
  waves: Wave[] = [];
  rollers: Roller[] = [];
  readonly homeX: number;
  readonly hoverY: number;
  readonly floorY: number;
  readonly arenaL: number;
  readonly arenaR: number;

  constructor(cfg: BossConfig, L: LevelData) {
    this.cfg = cfg;
    this.hp = cfg.hp;
    const home = L.bossHome!;
    const hc = Math.floor(home.x / TILE);
    let r = Math.floor(home.y / TILE);
    const isWall = (c: number, rr: number) => {
      const t = L.tiles[rr * L.w + c];
      return c < 0 || c >= L.w || t === SOLID || t === ALT || t === DOOR;
    };
    while (r < L.h - 1 && !isWall(hc, r + 1)) r++;
    this.floorY = (r + 1) * TILE;
    let l = hc;
    while (!isWall(l - 1, r)) l--;
    let rr = hc;
    while (!isWall(rr + 1, r)) rr++;
    this.arenaL = l * TILE;
    this.arenaR = (rr + 1) * TILE;
    this.homeX = home.x - BOSS_W / 2;
    this.hoverY = home.y - BOSS_H / 2;
    this.reset();
  }

  reset() {
    this.hp = this.cfg.hp;
    this.state = 'idle';
    this.x = this.homeX;
    this.y = this.hoverY - 420;
    this.vy = 0;
    this.t = 0;
    this.flash = 0;
    this.next = 'slam';
    this.thrown = 0;
    this.waves = [];
    this.rollers = [];
  }

  clone(): Boss {
    const b: Boss = Object.create(Boss.prototype);
    Object.assign(b, this);
    b.waves = this.waves.map((w) => ({ ...w }));
    b.rollers = this.rollers.map((r) => ({ ...r }));
    return b;
  }

  get active() {
    return this.state !== 'idle' && this.state !== 'dead';
  }
  get solid() {
    return this.state === 'stunned';
  }
  get phase2() {
    return this.hp <= Math.ceil(this.cfg.hp / 2);
  }

  start(emit: Emit) {
    if (this.state !== 'idle') return;
    this.setState('intro');
    emit('bossIntro', this.x + BOSS_W / 2, this.hoverY);
  }

  private setState(s: BossStateName) {
    this.state = s;
    this.t = 0;
  }

  /** Player centre after t seconds: they run at constant speed and bounce off the arena walls. */
  predict(cx: number, dir: number, t: number) {
    const lo = this.arenaL + PLAYER_W / 2;
    const span = this.arenaR - PLAYER_W / 2 - lo;
    let u = cx - lo + dir * RUN_SPEED * t;
    u = ((u % (2 * span)) + 2 * span) % (2 * span);
    return u <= span ? { x: lo + u, dir } : { x: lo + 2 * span - u, dir: -dir };
  }

  /**
   * The player cannot stop, so the slam never targets them directly: the boss lands
   * next to where the player will be, and the shockwaves are what must be jumped.
   */
  private chooseSlamTarget(playerCX: number, playerDir: number, hoverTime: number) {
    const impact = hoverTime + (this.phase2 ? 0.45 : 0.6) + 0.4;
    const pr = this.predict(playerCX, playerDir, impact);
    const minC = this.arenaL + BOSS_W / 2;
    const maxC = this.arenaR - BOSS_W / 2;
    const options = [pr.x - pr.dir * 200, pr.x + pr.dir * 220, pr.x - pr.dir * 300, pr.x + pr.dir * 320];
    let c = options.find((o) => o >= minC && o <= maxC) ?? (pr.x < (minC + maxC) / 2 ? maxC : minC);
    c = Math.max(minC, Math.min(maxC, c));
    this.targetX = c - BOSS_W / 2;
  }

  /** Called when the player lands on the boss's head while it is stunned. */
  hit(emit: Emit) {
    this.hp--;
    this.flash = 0.35;
    this.waves = [];
    emit('bossHit', this.x + BOSS_W / 2, this.y, this.hp);
    if (this.hp <= 0) {
      this.rollers = [];
      this.setState('dying');
    } else {
      this.next = 'throw';
      this.setState('rise');
    }
  }

  private hoverTime() {
    return this.phase2 ? 1.0 : 1.5;
  }

  private enterHover(playerCX: number, playerDir: number) {
    this.setState('hover');
    if (this.next === 'slam') this.chooseSlamTarget(playerCX, playerDir, this.hoverTime());
  }

  update(playerCX: number, playerDir: number, emit: Emit) {
    const cfg = this.cfg;
    const p2 = this.phase2;
    const speedMul = p2 ? 1.35 : 1;
    this.t += DT;
    if (this.flash > 0) this.flash -= DT;

    switch (this.state) {
      case 'idle':
      case 'dead':
        break;
      case 'intro': {
        const k = Math.min(1, this.t / 2);
        const e = 1 - Math.pow(1 - k, 3);
        this.y = this.hoverY - 420 * (1 - e);
        if (this.t >= 2.2) this.enterHover(playerCX, playerDir);
        break;
      }
      case 'hover': {
        const target = this.next === 'slam' ? this.targetX : Math.max(this.arenaL, Math.min(this.arenaR - BOSS_W, playerCX - BOSS_W / 2));
        const step = cfg.hoverSpeed * speedMul * DT;
        if (Math.abs(target - this.x) <= step) this.x = target;
        else this.x += Math.sign(target - this.x) * step;
        this.y = this.hoverY + Math.sin(this.t * 4) * 6;
        if (this.t >= this.hoverTime()) {
          if (this.next === 'slam') {
            this.setState('windup');
            emit('bossWindup', this.x + BOSS_W / 2, this.y + BOSS_H);
          } else {
            this.thrown = 0;
            this.setState('throw');
          }
        }
        break;
      }
      case 'windup':
        if (this.t >= (p2 ? 0.45 : 0.6)) {
          this.vy = 0;
          this.setState('slam');
        }
        break;
      case 'slam':
        this.vy += 3200 * DT;
        this.y += this.vy * DT;
        if (this.y + BOSS_H >= this.floorY) {
          this.y = this.floorY - BOSS_H;
          this.waves.push({ x: this.x - WAVE_W / 2, dir: -1 }, { x: this.x + BOSS_W - WAVE_W / 2, dir: 1 });
          emit('bossSlam', this.x + BOSS_W / 2, this.floorY);
          this.setState('stunned');
        }
        break;
      case 'stunned':
        if (this.t >= cfg.stunTime * (p2 ? 0.8 : 1)) {
          this.next = 'throw';
          this.setState('rise');
        }
        break;
      case 'rise':
        this.y -= 300 * DT;
        if (this.y <= this.hoverY) {
          this.y = this.hoverY;
          this.enterHover(playerCX, playerDir);
        }
        break;
      case 'throw': {
        const count = cfg.rollerCount + (p2 ? 1 : 0);
        const interval = 0.55;
        if (this.thrown < count && this.t >= this.thrown * interval + 0.3) {
          const dir = playerCX < this.x + BOSS_W / 2 ? -1 : 1;
          this.rollers.push({ x: this.x + BOSS_W / 2, y: this.y + BOSS_H, vx: dir * 60, vy: -200, dir, rot: 0, onFloor: false });
          this.thrown++;
          emit('bossThrow', this.x + BOSS_W / 2, this.y + BOSS_H);
        }
        if (this.t >= count * interval + 0.9) {
          this.next = 'slam';
          this.enterHover(playerCX, playerDir);
        }
        break;
      }
      case 'dying':
        this.y += Math.sin(this.t * 40) * 1.5;
        if (Math.floor(this.t * 6) !== Math.floor((this.t - DT) * 6)) {
          emit('bossBoom', this.x + ((this.t * 977) % BOSS_W), this.y + ((this.t * 613) % BOSS_H));
        }
        if (this.t >= 2.2) {
          this.setState('dead');
          emit('bossDead', this.x + BOSS_W / 2, this.y + BOSS_H / 2);
        }
        break;
    }

    const wspeed = cfg.waveSpeed * (p2 ? 1.25 : 1);
    for (const w of this.waves) w.x += w.dir * wspeed * DT;
    this.waves = this.waves.filter((w) => w.x > this.arenaL - WAVE_W && w.x < this.arenaR);

    // Rollers stay slower than the player so they can never catch you from behind.
    const rspeed = Math.min(cfg.rollerSpeed, RUN_SPEED * 0.85);
    for (const r of this.rollers) {
      if (!r.onFloor) {
        r.vy += GRAVITY * DT;
        r.y += r.vy * DT;
        r.x += r.vx * DT;
        if (r.y + ROLLER_R >= this.floorY) {
          r.y = this.floorY - ROLLER_R;
          r.onFloor = true;
          r.vx = r.dir * rspeed;
        }
      } else {
        r.x += r.vx * DT;
      }
      r.rot += (r.vx * DT) / ROLLER_R;
    }
    this.rollers = this.rollers.filter((r) => r.x - ROLLER_R > this.arenaL && r.x + ROLLER_R < this.arenaR);
  }

  /** Does anything of the boss kill a player hitbox? */
  hurts(x: number, y: number, w: number, h: number): boolean {
    if (this.state === 'slam' || this.state === 'hover' || this.state === 'windup' || this.state === 'throw') {
      if (overlaps(x, y, w, h, this.x + 6, this.y + 6, BOSS_W - 12, BOSS_H - 6)) return true;
    }
    for (const wv of this.waves) {
      if (overlaps(x, y, w, h, wv.x + 3, this.floorY - WAVE_H + 4, WAVE_W - 6, WAVE_H - 4)) return true;
    }
    for (const r of this.rollers) {
      const cx = Math.max(x, Math.min(r.x, x + w));
      const cy = Math.max(y, Math.min(r.y, y + h));
      if ((cx - r.x) ** 2 + (cy - r.y) ** 2 < (ROLLER_R - 2) ** 2) return true;
    }
    return false;
  }
}
