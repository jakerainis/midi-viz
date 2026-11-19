import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import { PPQ, clipEnd } from '../../model/types';
import { songEnd } from '../../model/compile';
import { clampZoom, setArrange, useApp } from '../../state/store';
import type { ArrangeTool, Snap, TrackHeight } from '../../state/store';
import { setLoop } from '../../state/songActions';
import { GRIDS } from '../../model/timing';
import { useMaps } from '../hooks';
import * as I from '../icons';
import { HEAD_W, Timeline, timelineTicks } from './Timeline';
import { Overview } from './Overview';
import { Library } from './Library';
import { Inspector } from './Inspector';
import { EditorPane } from './EditorPane';
import styles from './Arrange.module.css';

/** Commands the keyboard shortcuts can reach while the arrange view is mounted. */
export const arrangeApi = {
  zoomBy: (_factor: number) => {},
  fit: () => {},
  zoomToSelection: () => {},
};

const TOOLS: { id: ArrangeTool; label: string; icon: ReactNode }[] = [
  { id: 'pointer', label: 'Pointer tool (V)', icon: <I.Pointer /> },
  { id: 'pencil', label: 'Pencil tool: click to drop the library riff (B)', icon: <I.Pencil /> },
  { id: 'split', label: 'Split tool: click a clip to split it at a repeat (S)', icon: <I.Scissors /> },
];

export function ArrangeView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoom = useApp((s) => s.arrange.zoom);
  const snap = useApp((s) => s.arrange.snap);
  const tool = useApp((s) => s.arrange.tool);
  const follow = useApp((s) => s.arrange.follow);
  const trackHeight = useApp((s) => s.arrange.trackHeight);
  const showDock = useApp((s) => s.arrange.showDock);
  const dockH = useApp((s) => s.arrange.dockH);
  const focus = useApp((s) => s.focus);
  const mainRef = useRef<HTMLElement>(null);

  /** Drag the divider to size the clip editor; double-click flips between a small and a large editor. */
  const onDividerDown = (e: RPointerEvent) => {
    e.preventDefault();
    const main = mainRef.current;
    if (!main) return;
    const move = (ev: PointerEvent) => {
      const r = main.getBoundingClientRect();
      setArrange({ dockH: Math.round(Math.max(120, Math.min(r.height - 200, r.bottom - ev.clientY))) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const loop = useApp((s) => s.song.loop);
  const { meter } = useMaps();

  // Zoom keeps a point steady: the pointer for wheel zoom, otherwise the left edge.
  const nextScroll = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const was = zoomRef.current;
    zoomRef.current = zoom;
    if (!el || was === zoom) return;
    el.scrollLeft = nextScroll.current ?? (el.scrollLeft * zoom) / was;
    nextScroll.current = null;
  }, [zoom]);

  const zoomAt = (factor: number, clientX?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const z0 = useApp.getState().arrange.zoom;
    const z1 = clampZoom(z0 * factor);
    if (z1 === z0) return;
    const offset = clientX === undefined ? 0 : Math.max(0, clientX - el.getBoundingClientRect().left - HEAD_W);
    nextScroll.current = Math.max(0, ((el.scrollLeft + offset) * z1) / z0 - offset);
    setArrange({ zoom: z1 });
  };

  const fitRange = (from: number, to: number) => {
    const el = scrollRef.current;
    if (!el || to <= from) return;
    const w = el.clientWidth - HEAD_W - 32;
    const z = clampZoom((w / (to - from)) * PPQ);
    nextScroll.current = Math.max(0, (from * z) / PPQ - 16);
    if (z === useApp.getState().arrange.zoom) el.scrollLeft = nextScroll.current;
    setArrange({ zoom: z });
  };

  useEffect(() => {
    arrangeApi.zoomBy = (f) => zoomAt(f);
    arrangeApi.fit = () => {
      const song = useApp.getState().song;
      fitRange(0, Math.max(songEnd(song), PPQ * 16));
    };
    arrangeApi.zoomToSelection = () => {
      const { song, selectedClipIds } = useApp.getState();
      const clips = song.clips.filter((c) => selectedClipIds.includes(c.id));
      if (clips.length) fitRange(Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => clipEnd(c, song.patterns[c.patternId]))));
      else if (song.loop.on) fitRange(song.loop.start, song.loop.end);
    };
  });

  // ⌘/ctrl + wheel (or pinch) zooms at the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        if (e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
        return;
      }
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      zoomAt(Math.exp(-d * 0.01), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const total = timelineTicks(useApp.getState().song, meter);
  const bar = (t: number) => Math.round(meter.barAt(t)) + 1;

  return (
    <div className={styles.view}>
      <aside aria-label="Library" className={`${styles.side} ${styles.sideLeft}`}>
        <Library />
      </aside>

      <main ref={mainRef} className={styles.main}>
        <div className={styles.toolbar}>
          <h1>Arrange</h1>
          <div role="group" aria-label="Tools" className={`seg ${styles.tools}`}>
            {TOOLS.map((t) => (
              <button key={t.id} aria-label={t.label} title={t.label} aria-pressed={tool === t.id} onClick={() => setArrange({ tool: t.id })}>
                {t.icon}
              </button>
            ))}
          </div>
          <label className={styles.label}>
            Snap
            <select className="select" value={snap} onChange={(e) => setArrange({ snap: e.target.value as Snap })} title="Snap for moving, trimming and splitting clips · ⌘ while dragging ignores it">
              <option value="bar">Bar</option>
              <option value="beat">Beat</option>
              {GRIDS.filter((g) => g.ticks < PPQ).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
              <option value="off">Off</option>
            </select>
          </label>
          <div style={{ flex: 1 }} />
          <button
            className="btn"
            aria-pressed={loop.on}
            title="Loop on/off · L — drag the strip at the top of the ruler to set it"
            onClick={() => setLoop({ on: !loop.on }, true)}
          >
            <span className={styles.dot} style={{ opacity: loop.on ? 1 : 0.35 }} />
            Loop {bar(loop.start)} – {bar(loop.end)}
          </button>
          <button className="btn" aria-pressed={follow} onClick={() => setArrange({ follow: !follow })}>
            Follow playback
          </button>
          <button className="btn" aria-pressed={showDock} title="Show or hide the clip editor · Tab" onClick={() => setArrange({ showDock: !showDock })}>
            Clip editor
          </button>
        </div>

        <div
          className={`${styles.timelineArea} ${focus === 'timeline' && showDock ? styles.timelineFocused : ''}`}
          onPointerDownCapture={() => focus !== 'timeline' && useApp.setState({ focus: 'timeline' })}
        >
        <Timeline scrollRef={scrollRef} />

        <div className={styles.footer}>
          <div className={styles.footGroup}>
            <span className={styles.footLabel}>Track height</span>
            <div role="radiogroup" aria-label="Track height" className="seg">
              {(['fit', 'S', 'M', 'L'] as TrackHeight[]).map((h) => (
                <button key={h} role="radio" aria-checked={trackHeight === h} onClick={() => setArrange({ trackHeight: h })}>
                  {h === 'fit' ? 'Fit' : h}
                </button>
              ))}
            </div>
          </div>
          <Overview scrollRef={scrollRef} total={total} onZoom={(z, scroll) => {
            nextScroll.current = scroll;
            if (clampZoom(z) === useApp.getState().arrange.zoom && scrollRef.current) scrollRef.current.scrollLeft = scroll;
            setArrange({ zoom: clampZoom(z) });
          }} />
          <div className={styles.footGroup} style={{ gap: 4 }}>
            <span className={styles.footLabel} style={{ marginRight: 4 }} title="⌘ scroll or pinch to zoom at the pointer">
              Zoom
            </span>
            <button className={`btn ${styles.zoomBtn}`} aria-label="Zoom out" title="Zoom out · −" onClick={() => zoomAt(1 / 1.4)}>
              <I.Minus />
            </button>
            <button className={`btn ${styles.zoomBtn}`} aria-label="Zoom in" title="Zoom in · =" onClick={() => zoomAt(1.4)}>
              <I.Plus />
            </button>
            <button className="btn" title="Fit the whole song · F" onClick={() => arrangeApi.fit()}>
              Fit song
            </button>
          </div>
        </div>

        </div>

        {showDock && (
          <>
            <div
              className={styles.paneDivider}
              role="separator"
              aria-orientation="horizontal"
              title="Drag to resize the clip editor · double-click for small/large"
              onPointerDown={onDividerDown}
              onDoubleClick={() => {
                const h = mainRef.current?.getBoundingClientRect().height ?? 800;
                setArrange({ dockH: dockH > h * 0.5 ? 300 : Math.round(h * 0.68) });
              }}
            />
            <div style={{ height: dockH, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <EditorPane />
            </div>
          </>
        )}
      </main>

      <aside aria-label="Inspector" className={`${styles.side} ${styles.sideRight}`}>
        <Inspector />
      </aside>
    </div>
  );
}
