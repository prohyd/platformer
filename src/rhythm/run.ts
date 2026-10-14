// The run: player physics locked to the song clock, collisions and timing judgements.
// Mistakes never stop the music: the runner turns into a ghost for a moment and keeps going.
import { CEIL_H, HALF, PH, SPIKE_H, type Chart, type Cue, type Pit } from './chart.ts';

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export interface RunEvent {
  type: 'jump' | 'orb' | 'land' | 'pad' | 'note' | 'grade' | 'miss' | 'step' | 'death';
  x: number;
  y: number;
  grade?: Grade;
  combo?: number;
}

const SUB = 1 / 240;
const WINDOW = 0.2;
const GHOST_TIME = 1.0;
const POINTS: Record<Grade, number> = { PERFECT: 300, GREAT: 180, GOOD: 80, MISS: 0 };

export class Run {
  c: Chart;
  t: number;
  x = 0;
  y = 0;
  vy = 0;
  grounded = true;
  coyote = 0;
  buffer = -1;
  ghost = 0;
  /** Hardcore only: the run is over. */
  dead = false;
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Record<Grade, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  notesTaken = 0;
  events: RunEvent[] = [];
  /** Recent positions for the trail. */
  trail: { x: number; y: number }[] = [];
  private fi = 0;
  private cueI = 0;

  constructor(c: Chart, startT: number) {
    this.c = c;
    this.t = startT;
    this.x = startT * c.speed;
    this.y = this.floorAt(this.x - HALF, this.x + HALF) ?? 0;
  }

  /** Highest floor under [xa, xb], or null over a pit. */
  floorAt(xa: number, xb: number): number | null {
    const fl = this.c.floors;
    while (this.fi > 0 && fl[this.fi].x0 > xa) this.fi--;
    while (this.fi < fl.length - 1 && fl[this.fi].x1 < xa) this.fi++;
    let best: number | null = null;
    for (let i = this.fi; i < fl.length && fl[i].x0 <= xb; i++) {
      if (fl[i].x1 >= xa && (best === null || fl[i].y > best)) best = fl[i].y;
    }
    return best;
  }

  private pitAt(x: number): Pit | undefined {
    return this.c.pits.find((p) => x >= p.x0 - HALF && x <= p.x1 + HALF);
  }

  /** Advance to song time `tEnd`; `presses` are song times of button presses. */
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
    this.expireCues();
  }

  private judge(time: number, kind: Cue['kind']) {
    let best: Cue | null = null;
    let bd = WINDOW;
    for (let i = this.cueI; i < this.c.cues.length; i++) {
      const cu = this.c.cues[i];
      if (cu.t - time > WINDOW) break;
      if (cu.judged || cu.kind !== kind) continue;
      const d = Math.abs(cu.t - time);
      if (d <= bd) {
        bd = d;
        best = cu;
      }
    }
    if (!best) return;
    best.judged = true;
    const grade: Grade = bd <= 0.05 ? 'PERFECT' : bd <= 0.095 ? 'GREAT' : 'GOOD';
    this.counts[grade]++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(POINTS[grade] * (1 + Math.min(this.combo, 60) / 20));
    this.events.push({ type: 'grade', x: best.x, y: best.y, grade, combo: this.combo });
  }

  private expireCues() {
    const cues = this.c.cues;
    while (this.cueI < cues.length && cues[this.cueI].t < this.t - WINDOW) {
      // A cue nobody pressed for but that was survived anyway costs nothing.
      cues[this.cueI].judged = true;
      this.cueI++;
    }
  }

  private press(time: number) {
    if (this.grounded || this.coyote > 0) {
      this.jump(this.c.v0, 'jump');
      this.judge(time, 'jump');
      return;
    }
    if (this.tryOrb(time)) return;
    this.buffer = time;
  }

  private tryOrb(time: number) {
    for (const o of this.c.orbs) {
      if (o.used || Math.abs(o.x - this.x) > this.c.tol.orbX) continue;
      if (Math.abs(o.y - (this.y + PH / 2)) > this.c.tol.orbY) continue;
      o.used = true;
      // the orb pulls you to its centre, so timing errors never pile up along a chain
      this.y = o.y - PH / 2;
      this.jump(o.v, 'orb');
      this.judge(time, 'orb');
      return true;
    }
    return false;
  }

  private jump(v: number, type: 'jump' | 'orb' | 'pad') {
    this.vy = v;
    this.grounded = false;
    this.coyote = 0;
    this.buffer = -1;
    this.events.push({ type, x: this.x, y: this.y });
  }

  miss() {
    if (this.ghost > 0 || this.dead) return;
    if (this.c.mode === 'hardcore') {
      this.dead = true;
      this.combo = 0;
      this.events.push({ type: 'death', x: this.x, y: this.y });
      return;
    }
    this.counts.MISS++;
    this.combo = 0;
    this.ghost = GHOST_TIME;
    this.events.push({ type: 'miss', x: this.x, y: this.y, grade: 'MISS' });
    // the cue we failed is consumed
    for (let i = this.cueI; i < this.c.cues.length; i++) {
      const cu = this.c.cues[i];
      if (cu.t > this.t + 0.5) break;
      if (!cu.judged && cu.t > this.t - 0.6) {
        cu.judged = true;
        break;
      }
    }
  }

  private step(dt: number) {
    const c = this.c;
    if (dt <= 0) return;
    this.x = (this.t + dt) * c.speed;
    if (this.ghost > 0) this.ghost = Math.max(0, this.ghost - dt);
    if (this.coyote > 0) this.coyote -= dt;

    const prevY = this.y;
    if (!this.grounded) {
      this.vy -= c.g * dt;
      this.y += this.vy * dt;
    }

    let floor = this.floorAt(this.x - HALF, this.x + HALF);
    const pit = floor === null ? this.pitAt(this.x) : undefined;
    if (floor === null && this.ghost > 0 && pit) {
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
        this.jump(c.v0, 'jump');
        this.judge(bt, 'jump');
      }
    }

    // Walls: a higher floor ahead that we were below a moment ago
    const front = this.floorAt(this.x + HALF - 2, this.x + HALF);
    if (front !== null && front > this.y + 1.5 && prevY < front - 1) {
      if (this.ghost <= 0 && front - this.y >= 6) this.miss();
      this.y = front;
      this.vy = 0;
      this.grounded = true;
    }

    // a press slightly before reaching an orb still counts
    if (!this.grounded && this.buffer >= 0 && this.t - this.buffer < c.tol.buffer) {
      const bt = this.buffer;
      if (this.tryOrb(bt)) this.buffer = -1;
    }

    // Fell into a pit
    if (!this.grounded && pit && this.y < pit.y - 150) {
      this.miss();
      this.y = pit.y;
      this.vy = 0;
      this.grounded = true;
    }

    // Spikes
    if (this.ghost <= 0) {
      for (const s of c.spikes) {
        if (s.x > this.x + HALF) break;
        if (s.x + s.w < this.x - HALF) continue;
        if (this.y < s.y + SPIKE_H - 6 && this.y + PH > s.y) {
          this.miss();
          break;
        }
      }
    }

    // Spiky ceilings
    if (this.ghost <= 0) {
      for (const s of c.ceils) {
        if (s.x > this.x + HALF) break;
        if (s.x + s.w < this.x - HALF) continue;
        if (this.y + PH > s.y + 3 && this.y < s.y + CEIL_H) {
          this.miss();
          break;
        }
      }
    }

    // Launch pads
    if (this.grounded) {
      for (const p of c.pads) {
        if (p.x - this.x < 14 && this.x - p.x < 24 && Math.abs(p.y - this.y) < 2) {
          this.jump(c.padV, 'pad');
          this.events.push({ type: 'pad', x: p.x, y: p.y });
          break;
        }
      }
    }

    // Gems
    for (const n of c.notes) {
      if (n.taken) continue;
      if (n.x > this.x + 30) break;
      if (Math.abs(n.x - this.x) < 26 && Math.abs(n.y - (this.y + PH / 2)) < 30) {
        n.taken = true;
        this.notesTaken++;
        this.score += 25;
        this.events.push({ type: 'note', x: n.x, y: n.y });
      }
    }
  }

  get accuracy() {
    const total = this.c.cues.length || 1;
    return (this.counts.PERFECT + this.counts.GREAT * 0.75 + this.counts.GOOD * 0.45) / total;
  }

  get rank() {
    const a = this.accuracy;
    if (a >= 0.95 && this.counts.MISS === 0) return 'S';
    if (a >= 0.85) return 'A';
    if (a >= 0.7) return 'B';
    if (a >= 0.5) return 'C';
    return 'D';
  }
}
