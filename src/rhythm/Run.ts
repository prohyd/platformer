// The run: runner physics locked to the song clock, collisions and mistakes.
// Scoring lives in Scorer; what happened during a frame is reported as RunEvents
// (the play scene turns them into sounds and visual effects).
import { CONFIG } from '../config.ts';
import { CEIL_H, HALF, PH, SPIKE_H } from './geometry.ts';
import { Scorer, type Grade } from './Scorer.ts';
import { speedAt, xAt } from './speed.ts';
import type { Chart, Cue, Orb, Pit } from './types.ts';

export type { Grade } from './Scorer.ts';

export interface RunEvent {
  type: 'jump' | 'orb' | 'land' | 'pad' | 'note' | 'grade' | 'miss' | 'death';
  x: number;
  y: number;
  grade?: Grade;
  combo?: number;
}

/** Physics sub-step: small enough that nothing is ever skipped. */
const SUB = 1 / 240;
const GHOST_TIME = CONFIG.timing.ghostTime;
/** The most a jump is stretched or squeezed to land on the beat, s. */
const MAX_FIX = 0.1;

export class Run {
  readonly c: Chart;
  readonly scorer: Scorer;
  /** Song time of the simulation. */
  t: number;
  x = 0;
  /** Feet height (y grows up). */
  y = 0;
  vy = 0;
  grounded = true;
  /** Time left to jump after running off an edge. */
  coyote = 0;
  /** Time of a press that is waiting for a landing or an orb (-1 = none). */
  buffer = -1;
  /** Flow mode: invulnerable after a mistake. */
  ghost = 0;
  /** Hardcore only: the run is over. */
  dead = false;
  /** What happened since the last frame. Cleared by whoever reads it. */
  events: RunEvent[] = [];
  /** Recent positions for the trail. */
  trail: { x: number; y: number }[] = [];
  private floorIdx = 0;

  constructor(c: Chart, startT: number) {
    this.c = c;
    this.scorer = new Scorer(c.cues);
    this.t = startT;
    this.x = xAt(c.speeds, startT);
    this.y = this.floorAt(this.x - HALF, this.x + HALF) ?? 0;
  }

  // ================================================================== public

  /** Advance to song time `tEnd`; `presses` are song times of button presses (sorted). */
  update(tEnd: number, presses: number[]) {
    if (this.dead) return;
    let pi = 0;
    while (this.t < tEnd - 1e-9) {
      let te = Math.min(tEnd, this.t + SUB);
      if (pi < presses.length && presses[pi] <= te) te = Math.max(this.t, presses[pi]);
      this.step(te - this.t);
      this.t = te;
      if (this.dead) return;
      while (pi < presses.length && presses[pi] <= this.t + 1e-9) this.press(presses[pi++]);
    }
    while (pi < presses.length) this.press(presses[pi++]);
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 24) this.trail.shift();
    this.scorer.expire(this.t);
  }

  /** Highest floor under [xa, xb], or null over a pit. */
  floorAt(xa: number, xb: number): number | null {
    const fl = this.c.floors;
    while (this.floorIdx > 0 && fl[this.floorIdx].x0 > xa) this.floorIdx--;
    while (this.floorIdx < fl.length - 1 && fl[this.floorIdx].x1 < xa) this.floorIdx++;
    let best: number | null = null;
    for (let i = this.floorIdx; i < fl.length && fl[i].x0 <= xb; i++) {
      if (fl[i].x1 >= xa && (best === null || fl[i].y > best)) best = fl[i].y;
    }
    return best;
  }

  // ================================================================== input

  private press(time: number) {
    if (this.grounded || this.coyote > 0) {
      this.groundJump(time);
      return;
    }
    if (this.tryOrb(time)) return;
    this.buffer = time;
  }

  private tryOrb(time: number) {
    const tol = this.c.tol;
    const speed = speedAt(this.c.speeds, this.t);
    const reach = tol.orb * speed;
    // the nearest orb wins: in fast chains the next orb is already within reach
    let best: Orb | null = null;
    for (const o of this.c.orbs) {
      if (o.x - this.x > reach) break;
      if (o.used || this.x - o.x > reach) continue;
      // where the runner will be when passing the orb; on a steep path a slightly early
      // jump arrives a bit higher or lower, which is a timing error, not a miss
      const dt = (o.x - this.x) / speed;
      const yThen = this.y + PH / 2 + this.vy * dt - (this.c.g / 2) * dt * dt;
      if (Math.abs(o.y - yThen) > tol.orbY + Math.abs(this.vy) * tol.orb * 0.5) continue;
      if (!best || Math.abs(o.x - this.x) < Math.abs(best.x - this.x)) best = o;
    }
    if (best) {
      const o = best;
      o.used = true;
      // the orb puts you back on the planned path (in height and in time),
      // so timing errors never pile up along a chain
      const late = this.t - o.t;
      this.y = o.y - PH / 2 + o.v * late - (this.c.g / 2) * late * late;
      this.jump(o.v - this.c.g * late, 'orb');
      this.grade(time, 'orb');
      return true;
    }
    return false;
  }

  /**
   * A jump from the ground. When it answers a cue, it lands exactly when the planned jump
   * would have: a slightly late jump is a bit lower, an early one a bit higher. So a small
   * timing error never carries over into the next jumps of a fast sequence.
   */
  private groundJump(pressT: number) {
    const res = this.scorer.judge(pressT, 'jump');
    const c = this.c;
    let v = c.v0;
    if (res) {
      const late = Math.max(-MAX_FIX, Math.min(MAX_FIX, this.t - res.cue.t));
      v = (c.g * (c.airT - late)) / 2;
    }
    this.jump(v, 'jump');
    if (res) this.events.push({ type: 'grade', x: res.cue.x, y: res.cue.y, grade: res.grade, combo: this.scorer.combo });
  }

  private jump(v: number, type: 'jump' | 'orb' | 'pad') {
    this.vy = v;
    this.grounded = false;
    this.coyote = 0;
    this.buffer = -1;
    this.events.push({ type, x: this.x, y: this.y });
  }

  private grade(time: number, kind: Cue['kind']) {
    const res = this.scorer.judge(time, kind);
    if (res) this.events.push({ type: 'grade', x: res.cue.x, y: res.cue.y, grade: res.grade, combo: this.scorer.combo });
  }

  /** Hit something. Flow: become a ghost for a moment. Hardcore: the run is over. */
  private miss() {
    if (this.ghost > 0 || this.dead) return;
    if (this.c.mode === 'hardcore') {
      this.dead = true;
      this.scorer.combo = 0;
      this.events.push({ type: 'death', x: this.x, y: this.y });
      return;
    }
    this.scorer.miss(this.t);
    this.ghost = GHOST_TIME;
    this.events.push({ type: 'miss', x: this.x, y: this.y, grade: 'MISS' });
  }

  // ================================================================== physics

  private step(dt: number) {
    if (dt <= 0) return;
    this.x = xAt(this.c.speeds, this.t + dt);
    if (this.ghost > 0) this.ghost = Math.max(0, this.ghost - dt);
    if (this.coyote > 0) this.coyote -= dt;

    const prevY = this.y;
    this.applyGravity(dt);
    const pit = this.resolveGround(prevY);
    this.resolveWalls(prevY);
    this.useBufferedOrb();
    this.checkPitFall(pit);
    this.checkHazards();
    this.checkPads();
    this.collectGems();
  }

  private applyGravity(dt: number) {
    if (this.grounded) return;
    this.vy -= this.c.g * dt;
    this.y += this.vy * dt;
  }

  /** Standing, walking off edges and landing. Returns the pit under the runner, if any. */
  private resolveGround(prevY: number): Pit | undefined {
    const c = this.c;
    let floor = this.floorAt(this.x - HALF, this.x + HALF);
    const pit = floor === null ? this.pitAt(this.x) : undefined;
    if (floor === null && this.ghost > 0 && pit) {
      // a ghost runs over pits as if they were bridges
      floor = pit.y;
      this.ghost = Math.max(this.ghost, 0.05);
    }

    if (this.grounded) {
      if (floor === null) {
        this.grounded = false;
        this.coyote = c.tol.coyote;
        this.vy = 0;
      } else if (floor < this.y - 0.5) {
        // walked off a step down
        this.grounded = false;
        this.vy = 0;
      } else {
        this.y = floor;
      }
    } else if (floor !== null && this.vy <= 0 && this.y <= floor && prevY >= floor - 8) {
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
      this.events.push({ type: 'land', x: this.x, y: this.y });
      if (this.buffer >= 0 && this.t - this.buffer < c.tol.buffer) {
        const bt = this.buffer;
        this.groundJump(bt);
      }
    }
    return pit;
  }

  /** A higher floor ahead that we were below a moment ago. */
  private resolveWalls(prevY: number) {
    const front = this.floorAt(this.x + HALF - 2, this.x + HALF);
    if (front !== null && front > this.y + 1.5 && prevY < front - 1) {
      if (this.ghost <= 0 && front - this.y >= 6) this.miss();
      this.y = front;
      this.vy = 0;
      this.grounded = true;
    }
  }

  /** A press slightly before reaching an orb still counts. */
  private useBufferedOrb() {
    if (!this.grounded && this.buffer >= 0 && this.t - this.buffer < this.c.tol.buffer) {
      if (this.tryOrb(this.buffer)) this.buffer = -1;
    }
  }

  private checkPitFall(pit: Pit | undefined) {
    if (!this.grounded && pit && this.y < pit.y - 150) {
      this.miss();
      this.y = pit.y;
      this.vy = 0;
      this.grounded = true;
    }
  }

  private checkHazards() {
    if (this.ghost > 0) return;
    for (const s of this.c.spikes) {
      if (s.x > this.x + HALF) break;
      if (s.x + s.w < this.x - HALF) continue;
      if (this.y < s.y + SPIKE_H - 6 && this.y + PH > s.y) return this.miss();
    }
    for (const s of this.c.ceils) {
      if (s.x > this.x + HALF) break;
      if (s.x + s.w < this.x - HALF) continue;
      if (this.y + PH > s.y + 3 && this.y < s.y + CEIL_H) return this.miss();
    }
  }

  private checkPads() {
    if (!this.grounded) return;
    for (const p of this.c.pads) {
      if (this.x >= p.x && this.x - p.x < 24 && Math.abs(p.y - this.y) < 2) {
        this.jump(p.v, 'pad');
        this.events.push({ type: 'pad', x: p.x, y: p.y });
        return;
      }
    }
  }

  private collectGems() {
    for (const n of this.c.notes) {
      if (n.taken) continue;
      if (n.x > this.x + 30) break;
      if (Math.abs(n.x - this.x) < 26 && Math.abs(n.y - (this.y + PH / 2)) < 30) {
        n.taken = true;
        this.scorer.gem();
        this.events.push({ type: 'note', x: n.x, y: n.y });
      }
    }
  }

  private pitAt(x: number): Pit | undefined {
    return this.c.pits.find((p) => x >= p.x0 - HALF && x <= p.x1 + HALF);
  }
}
