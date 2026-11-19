/** Keeps the audio engine in step with the store, and loads the built-in drum kit (public/kits). */
import { useSyncExternalStore } from 'react';
import { engine } from './engine';
import { builtinSource, fetchKitIndex, loadKit } from './kit';
import type { KitSource, LoadedKit } from './kit';
import { setKit, useApp } from '../state/store';
import type { KitState } from '../state/store';

export function connectEngine() {
  const s = useApp.getState();
  engine.setSong(s.song);
  engine.metronome = s.metronome;
  engine.velCurve = s.prefs.velCurve;
  engine.setMasterDb(s.prefs.masterDb);
  return useApp.subscribe((st, prev) => {
    if (st.song !== prev.song) engine.setSong(st.song);
    if (st.metronome !== prev.metronome) engine.metronome = st.metronome;
    if (st.prefs.velCurve !== prev.prefs.velCurve) engine.velCurve = st.prefs.velCurve;
    if (st.prefs.masterDb !== prev.prefs.masterDb) engine.setMasterDb(st.prefs.masterDb);
  });
}

/** The last kit played. (persist.ts drops the older 'midi-viz:kit' key, which named kits that no longer exist.) */
const KIT_KEY = 'midi-viz:kit:v2';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Re-reads the built-in kit list (/kits/index.json). */
export async function refreshKits() {
  setKit({ available: await fetchKitIndex() });
}

/** Loads the last used kit, else the default (first) built-in kit. */
export async function loadInitialKit() {
  try {
    await refreshKits();
  } catch (err) {
    console.error('Kit list failed to load', err);
  }
  const { available } = useApp.getState().kit;
  let wanted: string | null = null;
  try {
    wanted = localStorage.getItem(KIT_KEY);
  } catch {
    /* private mode */
  }
  const pick = available.find((k) => k.id === wanted)?.id ?? available[0]?.id;
  if (!pick) {
    setKit({ status: 'error', error: "Couldn't load the list of kits (/kits/index.json). Check your connection and reload." });
    return;
  }
  await selectKit(pick);
}

// ---- sources ----

const builtinCache = new Map<string, Promise<KitSource>>();

async function sourceFor(id: string): Promise<KitSource> {
  const entry = useApp.getState().kit.available.find((k) => k.id === id);
  if (!entry) throw new Error('That kit is not in /kits/index.json.');
  let p = builtinCache.get(id);
  if (!p) {
    p = builtinSource(entry);
    builtinCache.set(id, p);
    p.catch(() => builtinCache.delete(id));
  }
  return p;
}

let loadSeq = 0;

/**
 * Loads a kit and makes it the one that plays. With no kit playing yet, it starts playing as soon as kick, snare
 * and closed hat are in. When switching, the old kit keeps playing until the new one is complete, and stays if
 * the new one fails.
 */
export async function selectKit(id: string) {
  const seq = ++loadSeq;
  const stale = () => seq !== loadSeq;
  const st = useApp.getState().kit;
  const entry = st.available.find((k) => k.id === id);
  const builtin = !!entry;
  setKit({ status: 'loading', progress: 0, error: undefined, id, name: entry?.name ?? 'Kit', builtin, playable: !!engine.kit });
  try {
    const source = await sourceFor(id);
    if (stale()) return;
    const first = !engine.kit;
    const kit = await loadKit(engine.ctx, source, {
      cancelled: stale,
      onProgress: (p) => !stale() && setKit({ progress: p }),
      onPlayable: (k) => {
        if (!first) return;
        engine.setKit(k);
        setKit({ playable: true });
      },
    });
    if (stale()) return;
    if (!kit.layers.size) {
      throw new Error(
        kit.failed.length
          ? `None of its ${kit.failed.length} samples could be decoded by this browser.`
          : 'It has no samples for any drum the app knows.',
      );
    }
    engine.setKit(kit);
    setKit(readyState(kit));
    try {
      localStorage.setItem(KIT_KEY, kit.id);
    } catch {
      /* ignore */
    }
  } catch (err) {
    if (stale()) return;
    console.error('Kit failed to load', err);
    const name = entry?.name ?? 'That kit';
    const error = `${name} didn't load: ${message(err)}`;
    const playing = engine.kit;
    if (playing && playing.layers.size && playing.id !== id) {
      // Keep what was playing.
      setKit({ ...readyState(playing), error });
      return;
    }
    const fallback = useApp.getState().kit.available[0]?.id;
    if (fallback && fallback !== id) {
      await selectKit(fallback);
      if (!stale()) return;
      setKit({ error });
    } else setKit({ status: 'error', error, playable: false });
  }
}

const readyState = (kit: LoadedKit): Partial<KitState> => ({
  status: 'ready',
  progress: 1,
  playable: true,
  id: kit.id,
  name: kit.name,
  builtin: kit.builtin,
  seconds: kit.seconds,
  failed: kit.failed.length,
  rev: useApp.getState().kit.rev + 1,
});

/** Re-renders when transport state changes (play/stop/preview). */
export function useTransport() {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
