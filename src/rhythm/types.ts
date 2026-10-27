// Data types shared by the level generator, the run and the renderer.
// World coordinates: x grows to the right (x = song time × speed), y grows UP (0 = base floor).

export type Difficulty = 0 | 1 | 2;
export const DIFF_NAMES = ['Лёгкий', 'Нормальный', 'Сложный'];

/** flow: mistakes are forgiven and the song goes on. hardcore: one mistake = start over. */
export type Mode = 'flow' | 'hardcore';
export const MODE_NAMES: Record<Mode, string> = { flow: 'Поток', hardcore: 'Хардкор' };

/** A solid stretch of ground. */
export interface Floor {
  x0: number;
  x1: number;
  y: number;
}

/** A gap in the ground; `y` is the height of its edges. */
export interface Pit {
  x0: number;
  x1: number;
  y: number;
}

/** Spikes standing on the floor at height `y`. */
export interface Spike {
  x: number;
  w: number;
  y: number;
}

/** Spikes hanging from above; `y` is the bottom of the spikes. Only a jump hits them. */
export interface Ceil {
  x: number;
  w: number;
  y: number;
}

/** A ring in the air: pressing while touching it jumps again with velocity `v`. */
export interface Orb {
  x: number;
  y: number;
  t: number;
  v: number;
  /** Pressed between two beats (drawn pink). */
  offbeat: boolean;
  used: boolean;
}

/** A launch pad: throws the runner up without a press. */
export interface Pad {
  x: number;
  y: number;
  t: number;
  /** Take-off velocity. */
  v: number;
  /** A big pad (drawn larger, used on drops). */
  big: boolean;
}

/** From time `t` on the runner moves at `speed`; `x` is where that happens. */
export interface SpeedSeg {
  t: number;
  x: number;
  speed: number;
  /** Speed relative to the song's base speed (1 = normal). */
  mul: number;
}

/** A part of the song as the level sees it. */
export interface ChartSection {
  /** Start time, s. */
  t: number;
  /** World x of the start. */
  x: number;
  /** 0..1 */
  intensity: number;
  /** Parts that sound alike share a label. */
  label: number;
  drop: boolean;
}

/** A collectible gem. */
export interface Note {
  x: number;
  y: number;
  taken: boolean;
}

/** A moment where the player is expected to press the button. */
export interface Cue {
  t: number;
  x: number;
  y: number;
  kind: 'jump' | 'orb';
  judged: boolean;
}

/** How forgiving the physics are. */
export interface Tolerance {
  orbX: number;
  orbY: number;
  coyote: number;
  buffer: number;
}

/** A complete level built for one song. */
export interface Chart {
  mode: Mode;
  tol: Tolerance;
  /** Base running speed, px/s (see `speeds` for portals). */
  speed: number;
  /** Speed changes (speed portals), sorted by time; the first one starts before the song. */
  speeds: SpeedSeg[];
  /** Parts of the song, in order. */
  sections: ChartSection[];
  /** Length of one beat, s. */
  beatDur: number;
  /** Length of one jump, s (one or two beats). */
  airT: number;
  airBeats: number;
  /** Jump height. */
  H: number;
  /** Jump take-off velocity. */
  v0: number;
  /** Gravity. */
  g: number;
  beats: number[];
  floors: Floor[];
  pits: Pit[];
  spikes: Spike[];
  ceils: Ceil[];
  orbs: Orb[];
  pads: Pad[];
  notes: Note[];
  cues: Cue[];
  /** Times of the big moments (drops). */
  drops: number[];
  duration: number;
  /** Where the finish line is. */
  endX: number;
  /** Which patterns were placed where (for stats and debugging). */
  patterns?: PlacedPattern[];
}

/** A pattern the generator placed. */
export interface PlacedPattern {
  t: number;
  name: string;
}
