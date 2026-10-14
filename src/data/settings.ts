// What the player picked in the menu. Remembered between visits.
import type { Difficulty, Mode } from '../rhythm/types.ts';
import { storage } from './storage.ts';

export class Settings {
  mode: Mode = storage.get<Mode>('set-mode', 'flow');
  difficulty: Difficulty = storage.get<Difficulty>('set-diff', 1);
  /** Index of the selected track in the list. */
  selected: number = storage.get<number>('set-sel', 0);

  setMode(m: Mode) {
    this.mode = m;
    storage.set('set-mode', m);
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    storage.set('set-diff', d);
  }

  select(i: number) {
    this.selected = i;
    storage.set('set-sel', i);
  }
}
