// Best results per track, mode and difficulty, stored in this browser.
import type { Difficulty, Mode } from '../rhythm/types.ts';
import { storage } from './storage.ts';

export interface Best {
  score: number;
  rank: string;
  acc: number;
  combo: number;
  /** Hardcore: was the song finished? If not, `progress` is the best reach 0..1. */
  done?: boolean;
  progress?: number;
}

const KEY = 'rhythm-v1';
let store = storage.get<Record<string, Best>>(KEY, {});

const keyOf = (trackId: string, diff: Difficulty, mode: Mode) => (mode === 'flow' ? `${trackId}#${diff}` : `${trackId}#${mode}#${diff}`);

function write(k: string, b: Best) {
  store = { ...store, [k]: b };
  storage.set(KEY, store);
}

export const records = {
  get(trackId: string, diff: Difficulty, mode: Mode): Best | undefined {
    return store[keyOf(trackId, diff, mode)];
  },

  /** Best reach in hardcore as 0..100, or 100 if the song was finished. */
  hardcorePercent(trackId: string, diff: Difficulty): number {
    const b = store[keyOf(trackId, diff, 'hardcore')];
    if (!b) return 0;
    return b.done ? 100 : Math.floor((b.progress ?? 0) * 100);
  },

  /** A finished song. Returns true if it is a new record. */
  saveFinished(trackId: string, diff: Difficulty, mode: Mode, b: Best): boolean {
    const k = keyOf(trackId, diff, mode);
    const prev = store[k];
    if (prev && (prev.done ?? true) && prev.score >= b.score) return false;
    write(k, { ...b, done: true, progress: 1 });
    return true;
  },

  /** Hardcore death: remember how far the player got. Returns true if it is further than before. */
  saveProgress(trackId: string, diff: Difficulty, progress: number): boolean {
    const k = keyOf(trackId, diff, 'hardcore');
    const prev = store[k];
    if (prev && (prev.done || (prev.progress ?? 0) >= progress)) return false;
    write(k, { score: 0, rank: '', acc: 0, combo: 0, done: false, progress });
    return true;
  },
};
