import { Boss, BOSS_H, BOSS_W } from './boss.ts';
import {
  COYOTE_TIME,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  DEATH_TIME,
  DT,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_CUT_MULT,
  JUMP_V,
  MAX_FALL,
  ORB_V,
  PLAYER_H as PH,
  PLAYER_W as PW,
  RUN_SPEED,
  SAW_RADIUS,
  SPRING_V,
  STOMP_V,
  TILE,
  WALL_SLIDE_MAX,
  WALLJUMP_V,
} from './constants.ts';
import {
  ALT,
  BLUE,
  CRUMBLE,
  DOOR,
  GPORTAL,
  ONEWAY,
  pathPos,
  RED,
  SOLID,
  SPIKE_DOWN,
  SPIKE_UP,
  SPRING,
  type LevelData,
  type Point,
} from './level.ts';

export interface SimEvent {
  t: string;
  x: number;
  y: number;
  v?: number;
}

export interface Player {
  x: number;
  y: number;
  vy: number;
  dir: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  wallSlide: boolean;
  prevHeld: boolean;
  riding: number;
  springing: boolean;
  inPortal: boolean;
}

interface Checkpoint {
  x: number;
  y: number;
  dir: number;
  grav: number;
  toggle: number;
  flag: number;
}

const CRUMBLE_IDLE = 0;
const CRUMBLE_SHAKING = 1;
const CRUMBLE_FALLEN = 2;

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

const tmp: Point = { x: 0, y: 0 };
const tmp2: Point = { x: 0, y: 0 };

/**
 * Deterministic game simulation. One call to step() = one 1/60 s tick.
 * The only input is whether the jump button is held.
 */
export class Sim {
  readonly L: LevelData;
  time = 0;
  frame = 0;
  p: Player;
  grav = 1;
  toggle = 0;
  crumbleState: Uint8Array;
  crumbleTimer: Float32Array;
  ghost: number[] = [];
  coinsTaken: Uint8Array;
  orbCd: Float32Array;
  cp: Checkpoint;
  dead = false;
  deadTimer = 0;
  won = false;
  deaths = 0;
  boss: Boss | null = null;
  doorClosed = false;
  events: SimEvent[] = [];
  /** Previous-tick position, for render interpolation. */
  prevX = 0;
  prevY = 0;

  constructor(L: LevelData) {
    this.L = L;
    const sx = L.start.x * TILE + (TILE - PW) / 2;
    const sy = (L.start.y + 1) * TILE - PH;
    this.cp = { x: sx, y: sy, dir: 1, grav: 1, toggle: 0, flag: -1 };
    this.p = this.freshPlayer();
    this.crumbleState = new Uint8Array(L.crumbleTiles.length);
    this.crumbleTimer = new Float32Array(L.crumbleTiles.length);
    this.coinsTaken = new Uint8Array(L.coins.length);
    this.orbCd = new Float32Array(L.orbs.length);
    if (L.def.boss && L.bossHome) this.boss = new Boss(L.def.boss, L);
    this.prevX = this.p.x;
    this.prevY = this.p.y;
  }

  private freshPlayer(): Player {
    return {
      x: this.cp.x,
      y: this.cp.y,
      vy: 0,
      dir: this.cp.dir,
      grounded: true,
      coyote: 0,
      buffer: 0,
      wallSlide: false,
      prevHeld: true,
      riding: -1,
      springing: false,
      inPortal: false,
    };
  }

  clone(): Sim {
    const s: Sim = Object.create(Sim.prototype);
    Object.assign(s, this);
    s.p = { ...this.p };
    s.cp = { ...this.cp };
    s.crumbleState = this.crumbleState.slice();
    s.crumbleTimer = this.crumbleTimer.slice();
    s.coinsTaken = this.coinsTaken.slice();
    s.orbCd = this.orbCd.slice();
    s.ghost = this.ghost.slice();
    s.boss = this.boss ? this.boss.clone() : null;
    s.events = [];
    s.emit = (t, x, y, v) => {
      s.events.push({ t, x, y, v });
    };
    return s;
  }

  emit = (t: string, x: number, y: number, v?: number) => {
    this.events.push({ t, x, y, v });
  };

  get exitOpen() {
    return !this.boss || this.boss.state === 'dead';
  }

  // ---------------------------------------------------------------- solids

  tileSolid(tx: number, ty: number): boolean {
    const L = this.L;
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0 || ty >= L.h) return false;
    const i = ty * L.w + tx;
    switch (L.tiles[i]) {
      case SOLID:
      case ALT:
        return true;
      case CRUMBLE:
        return this.crumbleState[L.crumbleId[i]] !== CRUMBLE_FALLEN;
      case RED:
        return this.toggle === 0 && !this.ghost.includes(i);
      case BLUE:
        return this.toggle === 1 && !this.ghost.includes(i);
      case DOOR:
        return this.doorClosed;
    }
    return false;
  }

  /** Calls cb with every solid rect overlapping the box. Returns true if any. */
  private solids(x: number, y: number, w: number, h: number, cb?: (rx: number, ry: number, rw: number, rh: number, boss: boolean) => void): boolean {
    let any = false;
    const tx0 = Math.floor(x / TILE);
    const tx1 = Math.floor((x + w - 0.001) / TILE);
    const ty0 = Math.floor(y / TILE);
    const ty1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.tileSolid(tx, ty)) {
          any = true;
          if (!cb) return true;
          cb(tx * TILE, ty * TILE, TILE, TILE, false);
        }
      }
    }
    const b = this.boss;
    if (b && b.solid && overlaps(x, y, w, h, b.x, b.y, BOSS_W, BOSS_H)) {
      any = true;
      if (cb) cb(b.x, b.y, BOSS_W, BOSS_H, true);
    }
    return any;
  }

  // ---------------------------------------------------------------- movement

  private moveX(dx: number, carry: boolean): boolean {
    const p = this.p;
    if (dx === 0) return false;
    p.x += dx;
    if (!this.solids(p.x, p.y, PW, PH)) return false;
    if (!carry && !p.grounded) {
      // Ledge assist: forgive clipping a corner by a few pixels.
      for (let lift = 2; lift <= 10; lift += 2) {
        const ny = p.y - lift * this.grav;
        if (!this.solids(p.x, ny, PW, PH)) {
          p.y = ny;
          return false;
        }
      }
    }
    let edge = dx > 0 ? Infinity : -Infinity;
    this.solids(p.x, p.y, PW, PH, (rx, _ry, rw) => {
      edge = dx > 0 ? Math.min(edge, rx) : Math.max(edge, rx + rw);
    });
    p.x = dx > 0 ? edge - PW : edge;
    return true;
  }

  private land() {
    const p = this.p;
    if (!p.grounded) {
      p.grounded = true;
      this.emit('land', p.x + PW / 2, this.grav === 1 ? p.y + PH : p.y, Math.abs(p.vy));
    }
    p.vy = 0;
  }

  private moveY(dy: number, carry: boolean) {
    const p = this.p;
    const g = this.grav;
    if (dy === 0) return;
    const prevFeet = p.y + PH;
    p.y += dy;
    let edge = dy > 0 ? Infinity : -Infinity;
    let hitBoss = false;
    const hit = this.solids(p.x, p.y, PW, PH, (_rx, ry, _rw, rh, boss) => {
      if (boss) hitBoss = true;
      edge = dy > 0 ? Math.min(edge, ry) : Math.max(edge, ry + rh);
    });
    if (hit) {
      p.y = dy > 0 ? edge - PH : edge;
      if (hitBoss && dy > 0 && g === 1 && this.boss) {
        p.vy = -STOMP_V;
        p.springing = true;
        p.grounded = false;
        this.boss.hit(this.emit);
        return;
      }
      if (dy * g > 0) this.land();
      else if (!carry) {
        p.vy = 0;
        this.emit('bonk', p.x + PW / 2, p.y);
      }
      return;
    }
    // One-way surfaces only work with normal gravity.
    if (g !== 1 || dy <= 0) return;
    const newFeet = p.y + PH;
    let best = Infinity;
    let rideIdx = -1;
    const r0 = Math.floor(prevFeet / TILE);
    const r1 = Math.floor(newFeet / TILE);
    for (let r = r0; r <= r1; r++) {
      const top = r * TILE;
      if (top < prevFeet - 0.01 || top > newFeet || r < 0 || r >= this.L.h) continue;
      const tx0 = Math.floor(p.x / TILE);
      const tx1 = Math.floor((p.x + PW - 0.001) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx >= 0 && tx < this.L.w && this.L.tiles[r * this.L.w + tx] === ONEWAY && top < best) best = top;
      }
    }
    const movers = this.L.movers;
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      const now = pathPos(m, this.time, tmp);
      const mx = now.x;
      const top = now.y;
      const prevTop = pathPos(m, this.time - DT, tmp2).y;
      if (p.x < mx + m.w && p.x + PW > mx && prevFeet <= Math.max(top, prevTop) + 2 && newFeet >= top && top < best) {
        best = top;
        rideIdx = i;
      }
    }
    if (best < Infinity) {
      p.y = best - PH;
      p.riding = rideIdx;
      this.land();
    }
  }

  // ---------------------------------------------------------------- actions

  private doJump(v: number, kind: string) {
    const p = this.p;
    p.vy = -v * this.grav;
    p.grounded = false;
    p.coyote = 0;
    p.buffer = 0;
    p.springing = false;
    p.wallSlide = false;
    p.riding = -1;
    this.emit(kind, p.x + PW / 2, p.y + PH / 2);
    if (this.L.hasToggles) this.flipToggle();
  }

  private flipToggle() {
    this.toggle ^= 1;
    const want = this.toggle === 0 ? RED : BLUE;
    this.ghost = [];
    this.forTiles(this.p.x, this.p.y, PW, PH, (i, t) => {
      if (t === want) this.ghost.push(i);
    });
    this.emit('toggle', this.p.x, this.p.y, this.toggle);
  }

  private forTiles(x: number, y: number, w: number, h: number, cb: (i: number, t: number, tx: number, ty: number) => void) {
    const L = this.L;
    const tx0 = Math.max(0, Math.floor(x / TILE));
    const tx1 = Math.min(L.w - 1, Math.floor((x + w - 0.001) / TILE));
    const ty0 = Math.max(0, Math.floor(y / TILE));
    const ty1 = Math.min(L.h - 1, Math.floor((y + h - 0.001) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * L.w + tx;
        cb(i, L.tiles[i], tx, ty);
      }
    }
  }

  die() {
    if (this.dead || this.won) return;
    this.dead = true;
    this.deadTimer = DEATH_TIME;
    this.deaths++;
    this.emit('death', this.p.x + PW / 2, this.p.y + PH / 2);
  }

  private respawn() {
    this.dead = false;
    this.grav = this.cp.grav;
    this.toggle = this.cp.toggle;
    this.ghost = [];
    this.crumbleState.fill(0);
    this.crumbleTimer.fill(0);
    this.p = this.freshPlayer();
    this.prevX = this.p.x;
    this.prevY = this.p.y;
    if (this.boss && this.boss.state !== 'dead') {
      this.boss.reset();
      this.doorClosed = false;
    }
    this.emit('respawn', this.p.x + PW / 2, this.p.y + PH / 2);
  }

  // ---------------------------------------------------------------- tick

  step(held: boolean) {
    const L = this.L;
    const p = this.p;
    this.time += DT;
    this.frame++;
    this.prevX = p.x;
    this.prevY = p.y;

    // Crumbling blocks
    for (let i = 0; i < this.crumbleState.length; i++) {
      const s = this.crumbleState[i];
      if (s === CRUMBLE_IDLE) continue;
      this.crumbleTimer[i] -= DT;
      if (this.crumbleTimer[i] > 0) continue;
      const ti = L.crumbleTiles[i];
      const tx = ti % L.w;
      const ty = (ti - tx) / L.w;
      if (s === CRUMBLE_SHAKING) {
        this.crumbleState[i] = CRUMBLE_FALLEN;
        this.crumbleTimer[i] = CRUMBLE_RESPAWN;
        this.emit('crumble', tx * TILE + 16, ty * TILE + 16);
      } else if (!overlaps(p.x, p.y, PW, PH, tx * TILE, ty * TILE, TILE, TILE)) {
        this.crumbleState[i] = CRUMBLE_IDLE;
        this.emit('crumbleBack', tx * TILE + 16, ty * TILE + 16);
      }
    }
    for (let i = 0; i < this.orbCd.length; i++) if (this.orbCd[i] > 0) this.orbCd[i] -= DT;

    const b = this.boss;
    if (b) {
      b.update(p.x + PW / 2, p.dir, this.emit);
      // Landing on the player crushes them instead of pushing them through walls.
      if (b.solid && !this.dead && overlaps(p.x, p.y, PW, PH, b.x, b.y, BOSS_W, BOSS_H)) this.die();
    }

    if (this.won) return;
    if (this.dead) {
      this.deadTimer -= DT;
      if (this.deadTimer <= 0) this.respawn();
      return;
    }

    const g = this.grav;
    const pressed = held && !p.prevHeld;
    p.prevHeld = held;
    p.buffer = pressed ? JUMP_BUFFER : Math.max(0, p.buffer - DT);

    // Ride moving platforms
    if (p.riding >= 0) {
      const m = L.movers[p.riding];
      const a = pathPos(m, this.time - DT, tmp);
      const ax = a.x, ay = a.y;
      const b = pathPos(m, this.time, tmp2);
      this.moveX(b.x - ax, true);
      this.moveY(b.y - ay, true);
    }

    // Jumps: ground > wall > orb
    if (p.buffer > 0) {
      if (p.grounded || p.coyote > 0) {
        this.doJump(JUMP_V, 'jump');
      } else if (p.wallSlide) {
        p.dir = -p.dir;
        this.doJump(WALLJUMP_V, 'walljump');
      } else {
        for (let i = 0; i < L.orbs.length; i++) {
          const o = L.orbs[i];
          if (this.orbCd[i] > 0) continue;
          const cx = Math.max(p.x, Math.min(o.x, p.x + PW));
          const cy = Math.max(p.y, Math.min(o.y, p.y + PH));
          if ((cx - o.x) ** 2 + (cy - o.y) ** 2 < 20 * 20) {
            this.orbCd[i] = 0.5;
            this.doJump(ORB_V, 'orb');
            this.emit('orbUsed', o.x, o.y, i);
            break;
          }
        }
      }
    }

    // Vertical velocity
    let grav = GRAVITY;
    const rising = p.vy * g < 0;
    if (!rising) p.springing = false;
    else if (!held && !p.springing) grav *= JUMP_CUT_MULT;
    p.vy += grav * g * DT;
    if (p.wallSlide && p.vy * g > WALL_SLIDE_MAX) p.vy = WALL_SLIDE_MAX * g;
    if (p.vy * g > MAX_FALL) p.vy = MAX_FALL * g;

    // Horizontal
    const wasGrounded = p.grounded;
    const wasSliding = p.wallSlide;
    const hitWall = this.moveX(p.dir * RUN_SPEED * DT, false);
    p.wallSlide = false;
    if (hitWall) {
      if (wasGrounded) {
        p.dir = -p.dir;
        this.emit('flip', p.x + PW / 2, p.y + PH / 2);
      } else {
        p.wallSlide = true;
        if (!wasSliding) this.emit('wallHit', p.x + (p.dir > 0 ? PW : 0), p.y + PH / 2);
      }
    }

    // Vertical
    p.grounded = false;
    p.riding = -1;
    this.moveY(p.vy * DT, false);
    if (p.grounded) p.wallSlide = false;
    p.coyote = p.grounded ? COYOTE_TIME : Math.max(0, p.coyote - DT);

    if (this.ghost.length) {
      this.ghost = this.ghost.filter((i) => {
        const tx = i % L.w;
        const ty = (i - tx) / L.w;
        return overlaps(p.x, p.y, PW, PH, tx * TILE, ty * TILE, TILE, TILE);
      });
    }

    this.interact();
  }

  private interact() {
    const L = this.L;
    const p = this.p;
    const g = this.grav;

    // Crumble blocks under the feet start shaking
    if (p.grounded) {
      const row = g === 1 ? Math.floor((p.y + PH + 1) / TILE) : Math.floor((p.y - 1) / TILE);
      if (row >= 0 && row < L.h) {
        const tx0 = Math.floor(p.x / TILE);
        const tx1 = Math.floor((p.x + PW - 0.001) / TILE);
        for (let tx = tx0; tx <= tx1; tx++) {
          const i = row * L.w + tx;
          if (L.tiles[i] === CRUMBLE) {
            const id = L.crumbleId[i];
            if (this.crumbleState[id] === CRUMBLE_IDLE) {
              this.crumbleState[id] = CRUMBLE_SHAKING;
              this.crumbleTimer[id] = CRUMBLE_DELAY;
              this.emit('crumbleStart', tx * TILE + 16, row * TILE);
            }
          }
        }
      }
    }

    // Tiles touching the player
    let inPortal = false;
    let springTop = -1;
    let hurt = false;
    this.forTiles(p.x, p.y, PW, PH, (_i, t, tx, ty) => {
      const x = tx * TILE;
      const y = ty * TILE;
      if (t === SPIKE_UP && overlaps(p.x + 2, p.y + 2, PW - 4, PH - 4, x + 5, y + 14, 22, 18)) hurt = true;
      else if (t === SPIKE_DOWN && overlaps(p.x + 2, p.y + 2, PW - 4, PH - 4, x + 5, y, 22, 18)) hurt = true;
      else if (t === GPORTAL) inPortal = true;
      else if (t === SPRING && g === 1 && overlaps(p.x, p.y, PW, PH, x + 3, y + 18, 26, 14)) springTop = y + 18;
    });
    if (hurt) return this.die();

    if (springTop >= 0 && p.vy >= 0) {
      p.y = springTop - PH;
      p.vy = -SPRING_V;
      p.springing = true;
      p.grounded = false;
      p.coyote = 0;
      p.riding = -1;
      this.emit('spring', p.x + PW / 2, springTop);
    }

    if (inPortal && !p.inPortal) {
      this.grav = -this.grav;
      p.vy *= 0.4;
      p.grounded = false;
      p.coyote = 0;
      p.riding = -1;
      this.emit('gravity', p.x + PW / 2, p.y + PH / 2, this.grav);
    }
    p.inPortal = inPortal;

    // Saws
    for (const s of L.saws) {
      const c = pathPos(s, this.time, tmp);
      const cx = Math.max(p.x + 2, Math.min(c.x, p.x + PW - 2));
      const cy = Math.max(p.y + 2, Math.min(c.y, p.y + PH - 2));
      if ((cx - c.x) ** 2 + (cy - c.y) ** 2 < (SAW_RADIUS - 1) ** 2) return this.die();
    }

    // Gems
    for (let i = 0; i < L.coins.length; i++) {
      if (this.coinsTaken[i]) continue;
      const c = L.coins[i];
      if (overlaps(p.x - 6, p.y - 6, PW + 12, PH + 12, c.x, c.y, 0.01, 0.01)) {
        this.coinsTaken[i] = 1;
        this.emit('coin', c.x, c.y);
      }
    }

    // Checkpoints
    for (let i = 0; i < L.flags.length; i++) {
      if (i === this.cp.flag) continue;
      const f = L.flags[i];
      if (overlaps(p.x, p.y, PW, PH, f.x * TILE, f.y * TILE - 16, TILE, TILE + 32)) {
        const y = g === 1 ? (f.y + 1) * TILE - PH : f.y * TILE;
        this.cp = { x: f.x * TILE + (TILE - PW) / 2, y, dir: p.dir, grav: g, toggle: this.toggle, flag: i };
        this.emit('checkpoint', f.x * TILE + 16, f.y * TILE, i);
      }
    }

    // Boss
    const b = this.boss;
    if (b) {
      if (b.state === 'idle' && L.triggerX !== null && p.x > L.triggerX) {
        this.doorClosed = true;
        b.start(this.emit);
        this.emit('doorClose', L.triggerX, p.y);
      }
      if (b.hurts(p.x + 2, p.y + 2, PW - 4, PH - 4)) return this.die();
    }

    // Exit
    const e = L.exit;
    if (e && this.exitOpen && overlaps(p.x, p.y, PW, PH, e.x * TILE + 4, (e.y - 1) * TILE, TILE - 8, TILE * 2)) {
      this.won = true;
      this.emit('win', e.x * TILE + 16, e.y * TILE);
      return;
    }

    // Fell out of the world
    if ((g === 1 && p.y > L.h * TILE + 40) || (g === -1 && p.y + PH < -60)) this.die();
  }
}
