// All playable tracks (the playlist folder + files the player added) and their loading.
import { analyze, type Analysis } from '../audio/analyze.ts';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import { PLAYLIST, trackFromName, type Track } from './playlist.ts';

export interface LoadedTrack {
  buffer: AudioBuffer;
  analysis: Analysis;
}

export class TrackLibrary {
  readonly tracks: Track[] = [...PLAYLIST];
  private readonly audio: AudioEngine;
  /** Decoded audio + analysis, so a retry starts instantly. */
  private readonly cache = new Map<string, LoadedTrack>();

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  /** Adds a file the player dropped or picked (or finds it if it is already there). */
  addFile(f: File): Track {
    const id = `file:${f.name}:${f.size}`;
    let t = this.tracks.find((x) => x.id === id);
    if (!t) {
      t = { id, file: f, ...trackFromName(f.name) };
      if (!t.artist) t.artist = 'твой трек';
      this.tracks.push(t);
    }
    return t;
  }

  indexOf(t: Track) {
    return this.tracks.indexOf(t);
  }

  /** The track after `t`, wrapping around. */
  next(t: Track): Track {
    return this.tracks[(this.indexOf(t) + 1) % this.tracks.length];
  }

  /** Downloads, decodes and analyses a track. `onProgress` gets 0..1. */
  async load(track: Track, onProgress: (p: number) => void): Promise<LoadedTrack> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    const data = track.file ? await track.file.arrayBuffer() : await (await fetch(track.url!)).arrayBuffer();
    onProgress(0.08);
    const buffer = await this.audio.decode(data);
    const analysis = await analyze(buffer, (p) => onProgress(0.1 + p * 0.9));
    const loaded = { buffer, analysis };
    this.cache.set(track.id, loaded);
    return loaded;
  }
}
