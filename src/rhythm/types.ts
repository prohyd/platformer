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
  /** Running speed, px/s. */
  speed: number;
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
  /** Launch pad velocity. */
  padV: number;
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
}
