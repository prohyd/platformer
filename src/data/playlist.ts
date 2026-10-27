// Every audio file in the /playlist folder becomes a level.
// File name format: "Artist - Title.mp3" (an optional "01 " prefix sets the order).
const files = import.meta.glob('/playlist/*.{mp3,ogg,wav,m4a,flac}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Track {
  id: string;
  title: string;
  artist: string;
  url?: string;
  file?: File;
}

export function trackFromName(name: string): { title: string; artist: string } {
  let base = name.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '');
  // names from download sites: "Artist_-_Title_12345678"
  base = base.replace(/_\d{5,}$/, '');
  if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { title: base.trim(), artist: '' };
}

export const PLAYLIST: Track[] = Object.keys(files)
  .sort((a, b) => a.localeCompare(b, 'ru'))
  .map((path) => {
    const name = decodeURIComponent(path.split('/').pop()!);
    return { id: name, url: files[path], ...trackFromName(name) };
  });
