// Game events sent to Yandex Metrika as goals with parameters.
import type { Track } from '../data/playlist.ts';
import { DIFF_NAMES, MODE_NAMES, type Difficulty, type Mode } from '../rhythm/types.ts';
import { goal, userParams } from './metrika.ts';

/** Track identity for every level event; custom = a file the player uploaded. */
const trackParams = (t: Track) => ({
  track: t.title,
  artist: t.artist || undefined,
  custom: !t.url,
});

const runParams = (mode: Mode, difficulty: Difficulty) => ({
  mode: MODE_NAMES[mode],
  difficulty: DIFF_NAMES[difficulty],
});

/** App opened: screen size and input type, once per page load. */
export function evAppOpen() {
  goal('app_open', {
    screen: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    touch: 'ontouchstart' in window,
  });
  userParams({
    touch: 'ontouchstart' in window,
    lang: navigator.language,
  });
}

/** A song starts (every hardcore attempt counts separately). */
export function evLevelStart(track: Track, mode: Mode, difficulty: Difficulty, attempt: number) {
  goal('level_start', { ...trackParams(track), ...runParams(mode, difficulty), attempt });
}

export interface CompleteParams {
  score: number;
  rank: string;
  /** 0..1, sent as percent with one decimal. */
  acc: number;
  combo: number;
  deaths: number;
  attempts: number;
  practice: boolean;
  record: boolean;
  duration: number;
}

/** A song is finished: the full result of the run. */
export function evLevelComplete(track: Track, mode: Mode, difficulty: Difficulty, r: CompleteParams) {
  goal('level_complete', {
    ...trackParams(track),
    ...runParams(mode, difficulty),
    score: r.score,
    rank: r.rank,
    acc_pct: Math.round(r.acc * 1000) / 10,
    max_combo: r.combo,
    deaths: r.deaths,
    attempts: r.attempts,
    practice: r.practice,
    duration_s: Math.round(r.duration),
  });
  if (r.record) goal('new_record', { ...trackParams(track), ...runParams(mode, difficulty), score: r.score });
}

/** The player died: where in the song it happened (0..1). */
export function evDeath(track: Track, mode: Mode, difficulty: Difficulty, progress: number) {
  goal('death', { ...trackParams(track), ...runParams(mode, difficulty), progress_pct: Math.round(progress * 100) });
}

/** The player quit to the menu mid-song from the pause menu. */
export function evLevelQuit(track: Track, mode: Mode, difficulty: Difficulty, progress: number) {
  goal('level_quit', { ...trackParams(track), ...runParams(mode, difficulty), progress_pct: Math.round(progress * 100) });
}

/** The player added their own audio file. */
export function evTrackUpload(f: File) {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : 'unknown';
  goal('track_upload', { ext, size_mb: Math.round(f.size / 104857.6) / 10 });
}
