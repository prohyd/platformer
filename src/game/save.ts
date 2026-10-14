// Progress is stored in the browser (per player, per device).
export interface LevelRecord {
  time: number;
  gems: number;
  deaths: number;
}

export interface SaveData {
  unlocked: number;
  best: Record<number, LevelRecord>;
}

const KEY = 'pryg-save-v1';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (typeof d.unlocked === 'number' && d.best) return d;
    }
  } catch {
    /* storage unavailable */
  }
  return { unlocked: 0, best: {} };
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}

export function recordLevel(d: SaveData, index: number, rec: LevelRecord, total: number): SaveData {
  const prev = d.best[index];
  d.best[index] = prev
    ? { time: Math.min(prev.time, rec.time), gems: Math.max(prev.gems, rec.gems), deaths: Math.min(prev.deaths, rec.deaths) }
    : rec;
  d.unlocked = Math.min(total - 1, Math.max(d.unlocked, index + 1));
  writeSave(d);
  return d;
}
