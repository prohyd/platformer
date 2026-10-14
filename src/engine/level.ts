import { PLATFORM_SPEED, SAW_SPEED, TILE } from './constants.ts';
import type { LevelDef } from './types.ts';

export const EMPTY = 0;
export const SOLID = 1;
export const ALT = 2;
export const ONEWAY = 3;
export const CRUMBLE = 4;
export const RED = 5;
export const BLUE = 6;
export const SPIKE_UP = 7;
export const SPIKE_DOWN = 8;
export const SPRING = 9;
export const DOOR = 10;
export const GPORTAL = 11;

const TILE_CHARS: Record<string, number> = {
  '#': SOLID,
  '%': ALT,
  '-': ONEWAY,
  C: CRUMBLE,
  R: RED,
  U: BLUE,
  '^': SPIKE_UP,
  v: SPIKE_DOWN,
  S: SPRING,
  D: DOOR,
  G: GPORTAL,
};

/** Oscillating path: position = a + (b - a) * (1 - cos(2πt/period + phase)) / 2 */
export interface Path {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  period: number;
  phase: number;
}

export interface Mover extends Path {
  w: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LevelData {
  def: LevelDef;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** tile index -> crumble id, or -1 */
  crumbleId: Int32Array;
  crumbleTiles: number[];
  hasToggles: boolean;
  coins: Point[];
  orbs: Point[];
  flags: Point[];
  start: Point;
  exit: Point | null;
  movers: Mover[];
  saws: Path[];
  bossHome: Point | null;
  triggerX: number | null;
}

export function pathPos(p: Path, t: number, out: Point): Point {
  const u = p.period > 0 ? (1 - Math.cos((2 * Math.PI * t) / p.period + p.phase)) / 2 : 0;
  out.x = p.ax + (p.bx - p.ax) * u;
  out.y = p.ay + (p.by - p.ay) * u;
  return out;
}

export function buildRows(def: LevelDef): string[] {
  const height = Math.max(17, ...def.sections.map((s) => s.length));
  const rows: string[] = new Array(height).fill('');
  for (const sec of def.sections) {
    const w = Math.max(...sec.map((r) => r.length));
    const pad = height - sec.length;
    for (let r = 0; r < height; r++) {
      const src = r < pad ? '' : sec[r - pad];
      rows[r] += src.padEnd(w, '.');
    }
  }
  return rows;
}

function makePath(ax: number, ay: number, bx: number, by: number, u0: number, speed: number): Path {
  const dist = Math.hypot(bx - ax, by - ay);
  const period = dist > 0 ? (2 * dist) / speed : 0;
  const phase = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * u0)));
  return { ax, ay, bx, by, period, phase };
}

export function parseLevel(def: LevelDef): LevelData {
  const rows = buildRows(def);
  const h = rows.length;
  const w = rows[0].length;
  const at = (c: number, r: number) => (r >= 0 && r < h && c >= 0 && c < w ? rows[r][c] : '.');

  const tiles = new Uint8Array(w * h);
  const crumbleId = new Int32Array(w * h).fill(-1);
  const data: LevelData = {
    def,
    w,
    h,
    tiles,
    crumbleId,
    crumbleTiles: [],
    hasToggles: false,
    coins: [],
    orbs: [],
    flags: [],
    start: { x: TILE, y: (h - 3) * TILE },
    exit: null,
    movers: [],
    saws: [],
    bossHome: null,
    triggerX: null,
  };

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      const i = r * w + c;
      const t = TILE_CHARS[ch];
      if (t !== undefined) {
        tiles[i] = t;
        if (t === CRUMBLE) {
          crumbleId[i] = data.crumbleTiles.length;
          data.crumbleTiles.push(i);
        }
        if (t === RED || t === BLUE) data.hasToggles = true;
        continue;
      }
      const cx = c * TILE + TILE / 2;
      const cy = r * TILE + TILE / 2;
      switch (ch) {
        case '*':
          data.coins.push({ x: cx, y: cy });
          break;
        case 'O':
          data.orbs.push({ x: cx, y: cy });
          break;
        case 'F':
          data.flags.push({ x: c, y: r });
          break;
        case 'P':
          data.start = { x: c, y: r };
          break;
        case 'E':
          data.exit = { x: c, y: r };
          break;
        case 'B':
          data.bossHome = { x: cx, y: cy };
          break;
        case 'T':
          data.triggerX = c * TILE;
          break;
        case 'X': {
          let l = 0, rr = 0, up = 0, dn = 0;
          while (at(c - l - 1, r) === ':') l++;
          while (at(c + rr + 1, r) === ':') rr++;
          while (at(c, r - up - 1) === ':') up++;
          while (at(c, r + dn + 1) === ':') dn++;
          if (l + rr > 0) {
            data.saws.push(makePath((c - l) * TILE + 16, cy, (c + rr) * TILE + 16, cy, l / (l + rr), SAW_SPEED));
          } else if (up + dn > 0) {
            data.saws.push(makePath(cx, (r - up) * TILE + 16, cx, (r + dn) * TILE + 16, up / (up + dn), SAW_SPEED));
          } else {
            data.saws.push(makePath(cx, cy, cx, cy, 0, SAW_SPEED));
          }
          break;
        }
        case '=': {
          if (at(c - 1, r) === '=') break;
          let len = 0;
          while (at(c + len, r) === '=') len++;
          let l = 0, rr = 0;
          while (at(c - l - 1, r) === '~') l++;
          while (at(c + len + rr, r) === '~') rr++;
          const span = l + rr;
          const p = makePath((c - l) * TILE, r * TILE, (c + rr) * TILE, r * TILE, span ? l / span : 0, PLATFORM_SPEED);
          data.movers.push({ ...p, w: len * TILE });
          break;
        }
        case 'H': {
          if (at(c - 1, r) === 'H') break;
          let len = 0;
          while (at(c + len, r) === 'H') len++;
          let up = 0, dn = 0;
          while (at(c, r - up - 1) === '|') up++;
          while (at(c, r + dn + 1) === '|') dn++;
          const span = up + dn;
          const p = makePath(c * TILE, (r - up) * TILE, c * TILE, (r + dn) * TILE, span ? up / span : 0, PLATFORM_SPEED);
          data.movers.push({ ...p, w: len * TILE });
          break;
        }
      }
    }
  }
  return data;
}
