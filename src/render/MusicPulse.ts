// Signals that make the picture move with the music.
import type { Levels } from '../audio/AudioEngine.ts';

export class MusicPulse {
  /** 1 exactly on a beat, fading to 0 before the next one. */
  beatPulse = 0;
  /** Jumps up when the bass hits (live from the speakers), then fades. */
  kick = 0;
  /** Smoothed spectrum, 48 bands 0..1 (drives the city skyline). */
  readonly bands = new Float32Array(48);
  private bassAvg = 0.3;
  private time = 0;

  /** `beats` = beat times of the current song, or null in the menu (then a steady 120 BPM pulse). */
  update(dt: number, lv: Levels, beats: number[] | null, songT: number) {
    this.time += dt;
    for (let i = 0; i < 48; i++) this.bands[i] += (lv.bands[i] - this.bands[i]) * Math.min(1, dt * 18);
    this.bassAvg += (lv.bass - this.bassAvg) * Math.min(1, dt * 1.5);
    const kickNow = Math.max(0, lv.bass - this.bassAvg * 0.9) * 3;
    this.kick = Math.max(kickNow, this.kick * Math.exp(-dt * 7));
    if (beats) {
      // binary search for the last beat that has already played
      let lo = 0;
      let hi = beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (beats[mid] <= songT) lo = mid;
        else hi = mid - 1;
      }
      const since = songT - (beats[lo] ?? 0);
      this.beatPulse = songT >= 0 && since >= 0 ? Math.exp(-since * 9) : 0;
    } else {
      this.beatPulse = Math.exp(-((this.time * 2) % 1) * 9);
    }
  }
}
