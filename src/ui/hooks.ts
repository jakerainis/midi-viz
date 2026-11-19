import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { engine } from '../audio/engine';
import { MeterMap, TempoMap } from '../model/timing';
import { useApp } from '../state/store';

/** Calls `fn` every animation frame while mounted. Used for the playhead and LCD, which skip React renders. */
export function useFrame(fn: (t: number) => void) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Tempo and meter maps for the current song, rebuilt only when they change. */
export function useMaps() {
  const tempo = useApp((s) => s.song.tempo);
  const meter = useApp((s) => s.song.meter);
  return useMemo(() => ({ tempo: new TempoMap(tempo), meter: new MeterMap(meter) }), [tempo, meter]);
}

/** Applies the theme and accent to <html>. */
export function useThemeEffect() {
  const theme = useApp((s) => s.prefs.theme);
  const accent = useApp((s) => s.prefs.accent);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', accent);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent]);
}

export const playheadTick = () => engine.position();
