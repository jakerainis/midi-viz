/** Autosave: the open song and the user's settings go to localStorage. Projects can also be saved as files. */
import type { Song } from '../model/types';
import { loadSong, newSong, useApp } from './store';
import type { AppState } from './store';
import { migrateSong } from '../model/migrate';

const SONG_KEY = 'midi-viz:song:v3';
const SETTINGS_KEY = 'midi-viz:settings:v3';
/** Keys from earlier builds; removed on startup so old demo data doesn't linger. */
const LEGACY_KEYS = ['midi-viz:song:v2', 'midi-viz:settings:v2', 'midi-viz:kit'];

type Settings = Pick<AppState, 'prefs' | 'mapping' | 'metronome'> & {
  arrange: Partial<AppState['arrange']>;
  editor: Partial<AppState['editor']>;
};

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function isSong(x: unknown): x is Song {
  const s = x as Song;
  return !!s && typeof s === 'object' && Array.isArray(s.tracks) && Array.isArray(s.clips) && typeof s.patterns === 'object' && Array.isArray(s.tempo);
}

/** Restores settings and the last song, or starts an empty song on first run. */
export async function restore() {
  for (const k of LEGACY_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }
  const settings = read<Settings>(SETTINGS_KEY);
  if (settings) {
    useApp.setState((s) => ({
      prefs: { ...s.prefs, ...settings.prefs },
      mapping: { ...s.mapping, ...settings.mapping },
      metronome: !!settings.metronome,
      arrange: { ...s.arrange, ...settings.arrange },
      editor: { ...s.editor, ...settings.editor },
    }));
  }
  const song = read<Song>(SONG_KEY);
  loadSong(isSong(song) ? migrateSong(song) : newSong());
}

/** Forgets the saved song and settings (kits you loaded stay) and reloads into an empty song. */
export function clearSavedData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('midi-viz:')) localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
  stopAutosave?.();
  location.reload();
}

let stopAutosave: (() => void) | null = null;

let timer: number | null = null;

/** Saves after changes settle. Call once at startup. */
export function startAutosave() {
  stopAutosave = useApp.subscribe((s, prev) => {
    if (s.song !== prev.song || s.prefs !== prev.prefs || s.mapping !== prev.mapping || s.arrange !== prev.arrange || s.editor !== prev.editor || s.metronome !== prev.metronome) {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const st = useApp.getState();
        write(SONG_KEY, st.song);
        const { zoom, trackHeight, snap, follow, showDock, dockH } = st.arrange;
        const { grid, lanes, lanesShown, zoom: ez, fitWidth, laneSize } = st.editor;
        write(SETTINGS_KEY, {
          prefs: st.prefs,
          mapping: st.mapping,
          metronome: st.metronome,
          arrange: { zoom, trackHeight, snap, follow, showDock, dockH },
          editor: { grid, lanes, lanesShown, zoom: ez, fitWidth, laneSize },
        } satisfies Settings);
        useApp.setState({ dirty: false });
      }, 400);
    }
  });
  return stopAutosave;
}

export function downloadSong(song: Song) {
  const blob = new Blob([JSON.stringify(song, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `${slug(song.name)}.midiviz.json`);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
