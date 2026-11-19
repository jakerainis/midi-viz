/**
 * App state (zustand). The song is immutable; every change goes through `edit()`, which records undo history.
 * UI-only state (view, zoom, selection) lives here too but never enters undo.
 */
import { create } from 'zustand';
import { produce } from 'immer';
import type { Draft } from 'immer';
import type { Song } from '../model/types';
import { PPQ, uid } from '../model/types';
import type { Pack } from '../model/library';

export type View = 'arrange' | 'kit' | 'mapping';
/** Which half of the Arrange view the keyboard acts on. */
export type Focus = 'timeline' | 'editor';
export type Overlay = null | 'export' | 'shortcuts';
/** Arrange snap: bar, beat, a note value from model/timing GRIDS ('1/16', '1/8T', …), or off. */
export type Snap = 'bar' | 'beat' | 'off' | string;
export type ArrangeTool = 'pointer' | 'pencil' | 'split';
export type EditTool = 'select' | 'draw' | 'erase' | 'line';
export type TrackHeight = 'fit' | 'S' | 'M' | 'L';
export type Theme = 'system' | 'dark' | 'light';
export type LanesShown = 'used' | 'common' | 'all';

export const TRACK_HEIGHTS: Record<Exclude<TrackHeight, 'fit'>, number> = { S: 48, M: 72, L: 112 };
export const ACCENTS = ['#FF9F43', '#F2665A', '#4FD1A5', '#5BA8FF'];

export interface KitState {
  id: string;
  name: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  /** Why the last kit didn't load. When another kit was playing, it keeps playing and status stays 'ready'. */
  error?: string;
  /** Ships with the app (public/kits) rather than stored in this browser. */
  builtin: boolean;
  /** Kick, snare and closed hat are in, so playback can start while the rest loads. */
  playable: boolean;
  seconds: number;
  /** Samples of the loaded kit this browser couldn't read or decode. */
  failed: number;
  /** Bumped whenever the playing kit's samples change, including edits to a custom kit. */
  rev: number;
  /** Kits that ship with the app (public/kits/index.json); the first is the default. */
  available: { id: string; name: string; path: string }[];
  /** An import or custom-kit save in progress, or how the last one went. */
}

export interface AppState {
  song: Song;
  past: Song[];
  future: Song[];
  /** Set when the song changed since the last autosave. */
  dirty: boolean;

  view: View;
  overlay: Overlay;
  focus: Focus;

  selectedClipIds: string[];
  selectedTrackId: string | null;
  selectedHitIds: string[];
  selectedSectionId: string | null;
  /** Clip open in the editor / dock. */
  editClipId: string | null;

  arrange: {
    /** Pixels per quarter note. */
    zoom: number;
    trackHeight: TrackHeight;
    snap: Snap;
    tool: ArrangeTool;
    follow: boolean;
    /** The clip editor under the timeline. */
    showDock: boolean;
    /** Its height in pixels (dragged with the divider). */
    dockH: number;
  };
  editor: {
    grid: string;
    tool: EditTool;
    lanes: 'kit' | 'raw';
    /** Which lanes the editor lists: only used ones, the everyday drums (+ used), or all 23. */
    lanesShown: LanesShown;
    zoom: number;
    /** Keep the whole riff fitted to the width (until you zoom). */
    fitWidth: boolean;
    laneSize: TrackHeight;
    /** Articulation shown in the velocity lane; null follows the selection. */
    velLane: string | null;
    lastVel: number;
  };
  prefs: {
    theme: Theme;
    accent: string;
    masterDb: number;
    velCurve: number;
  };
  library: {
    packs: Pack[];
    tab: 'packs' | 'project';
    query: string;
    bpmMin: number | null;
    bpmMax: number | null;
    open: Record<string, boolean>;
    activeKey: string | null;
  };
  mapping: {
    /** Pack name → note map id, where the user picked something other than the default. */
    packMaps: Record<string, string>;
    /** Map id → note → articulation (null = silent), on top of the built-in map. */
    overrides: Record<string, Record<number, string | null>>;
    selectedMapId: string;
  };
  kit: KitState;
  metronome: boolean;
}

const emptySong = (): Song => ({
  id: uid('song'),
  name: 'New song',
  tempo: [{ tick: 0, bpm: 120 }],
  meter: [{ tick: 0, num: 4, den: 4 }],
  sections: [],
  tracks: [
    { id: uid('t'), name: 'Drums', color: ACCENTS[0], mute: false, solo: false, volumeDb: 0 },
  ],
  clips: [],
  patterns: {},
  loop: { start: 0, end: PPQ * 16, on: false },
});

export const newSong = emptySong;

export const useApp = create<AppState>()(() => ({
  song: emptySong(),
  past: [],
  future: [],
  dirty: false,
  view: 'arrange',
  overlay: null,
  focus: 'timeline',
  selectedClipIds: [],
  selectedTrackId: null,
  selectedHitIds: [],
  selectedSectionId: null,
  editClipId: null,
  arrange: { zoom: 7, trackHeight: 'M', snap: 'bar', tool: 'pointer', follow: true, showDock: true, dockH: 420 },
  editor: { grid: '1/16', tool: 'select', lanes: 'kit', lanesShown: 'common', zoom: 160, fitWidth: true, laneSize: 'fit', velLane: null, lastVel: 100 },
  prefs: { theme: 'system', accent: ACCENTS[0], masterDb: 0, velCurve: 1 },
  library: { packs: [], tab: 'packs', query: '', bpmMin: null, bpmMax: null, open: {}, activeKey: null },
  mapping: { packMaps: {}, overrides: {}, selectedMapId: 'ugritone' },
  kit: { id: '', name: 'Drum kit', status: 'idle', progress: 0, builtin: true, playable: false, seconds: 0, failed: 0, rev: 0, available: [] },
  metronome: false,
}));

const HISTORY = 200;

/** Changes the song and records an undo step. Pass `{ history: false }` for the moves inside a drag. */
export function edit(recipe: (song: Draft<Song>) => void, opts: { history?: boolean } = {}) {
  const { song, past } = useApp.getState();
  const next = produce(song, recipe);
  if (next === song) return;
  if (opts.history === false) useApp.setState({ song: next, dirty: true });
  else useApp.setState({ song: next, past: [...past.slice(-HISTORY + 1), song], future: [], dirty: true });
}

/** Records the current song as an undo step before a gesture that edits with `{ history: false }`. */
export function checkpoint() {
  const { song, past } = useApp.getState();
  useApp.setState({ past: [...past.slice(-HISTORY + 1), song], future: [] });
}

/** Replaces the whole song (open, new) and clears history. */
export function loadSong(song: Song) {
  useApp.setState({
    song,
    past: [],
    future: [],
    dirty: false,
    selectedClipIds: [],
    selectedHitIds: [],
    editClipId: null,
    selectedTrackId: song.tracks[0]?.id ?? null,
  });
}

export function undo() {
  const { past, song, future } = useApp.getState();
  if (!past.length) return;
  useApp.setState({ song: past[past.length - 1], past: past.slice(0, -1), future: [song, ...future], dirty: true });
}

export function redo() {
  const { past, song, future } = useApp.getState();
  if (!future.length) return;
  useApp.setState({ song: future[0], past: [...past, song], future: future.slice(1), dirty: true });
}

export const setArrange = (patch: Partial<AppState['arrange']>) =>
  useApp.setState((s) => ({ arrange: { ...s.arrange, ...patch } }));
export const setEditor = (patch: Partial<AppState['editor']>) =>
  useApp.setState((s) => ({ editor: { ...s.editor, ...patch } }));
export const setPrefs = (patch: Partial<AppState['prefs']>) => useApp.setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
export const setLibrary = (patch: Partial<AppState['library']>) =>
  useApp.setState((s) => ({ library: { ...s.library, ...patch } }));
export const setMapping = (patch: Partial<AppState['mapping']>) =>
  useApp.setState((s) => ({ mapping: { ...s.mapping, ...patch } }));
export const setKit = (patch: Partial<KitState>) => useApp.setState((s) => ({ kit: { ...s.kit, ...patch } }));
export const setView = (view: View) => useApp.setState({ view, overlay: null });
export const setOverlay = (overlay: Overlay) => useApp.setState({ overlay });

export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 160;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
