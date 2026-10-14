export type ThemeId = 'meadow' | 'caves' | 'ruins' | 'volcano';

export interface BossConfig {
  name: string;
  hp: number;
  /** Horizontal speed while hovering over the arena, px/s. */
  hoverSpeed: number;
  /** Seconds the boss stays on the ground (vulnerable) after a slam. */
  stunTime: number;
  /** Speed of the ground shockwaves after a slam, px/s. */
  waveSpeed: number;
  /** How many rolling spike balls are thrown per volley. */
  rollerCount: number;
  rollerSpeed: number;
}

/**
 * A level is a list of ASCII sections glued left to right (bottom-aligned).
 * Legend (see README for details):
 *   #  ground          %  stone block        -  one-way platform
 *   C  crumbling block R  red toggle block   U  blue toggle block
 *   ^  floor spikes    v  ceiling spikes     S  spring
 *   O  jump orb        G  gravity portal     *  gem
 *   F  checkpoint      P  player start       E  exit
 *   =  horizontal moving platform, ~ its path
 *   H  vertical moving platform,   | its path (in the column of the first H)
 *   X  saw,            : saw path (horizontal or vertical line from X)
 *   B  boss home       T  boss trigger column D  boss arena door
 */
export interface LevelDef {
  name: string;
  theme: ThemeId;
  sections: string[][];
  hint?: string;
  boss?: BossConfig;
}
