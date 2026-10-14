// Best results per track and difficulty, stored in this browser.
export interface Best {
  score: number;
  rank: string;
  acc: number;
  combo: number;
  /** Hardcore: was the song finished? If not, `progress` is the best reach 0..1. */
  done?: boolean;
  progress?: number;
}

const KEY = 'pryg-rhythm-v1';
type Store = Record<string, Best>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

let store = load();

const key = (trackId: string, diff: number, mode: string) => (mode === 'flow' ? `${trackId}#${diff}` : `${trackId}#${mode}#${diff}`);

export function getBest(trackId: string, diff: number, mode = 'flow'): Best | undefined {
  return store[key(trackId, diff, mode)];
}

function write(k: string, b: Best) {
  store = { ...store, [k]: b };
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Hardcore: remember how far the player got. Returns true if it is further than before. */
export function saveProgress(trackId: string, diff: number, progress: number): boolean {
  const k = key(trackId, diff, 'hardcore');
  const prev = store[k];
  if (prev && (prev.done || (prev.progress ?? 0) >= progress)) return false;
  write(k, { score: 0, rank: '', acc: 0, combo: 0, done: false, progress });
  return true;
}

/** Returns true if this is a new record. */
export function saveBest(trackId: string, diff: number, b: Best, mode = 'flow'): boolean {
  const k = key(trackId, diff, mode);
  const prev = store[k];
  if (prev && (prev.done ?? true) && prev.score >= b.score) return false;
  write(k, { ...b, done: true, progress: 1 });
  return true;
}

export function getSetting<T>(name: string, def: T): T {
  try {
    const v = localStorage.getItem(`pryg-set-${name}`);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}

export function setSetting(name: string, v: unknown) {
  try {
    localStorage.setItem(`pryg-set-${name}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
