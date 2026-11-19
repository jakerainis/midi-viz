/**
 * The clip editor under the timeline: the selected clip's riff with the drum tools. It sizes like the timeline:
 * drag the divider above it, set lane height in its footer, and zoom with −/+/Fit, ⌘-scroll, or the overview strip.
 * Tab shows or hides it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, ReactNode, RefObject } from 'react';
import { engine } from '../../audio/engine';
import { GRIDS, barTicksFor } from '../../model/timing';
import { PPQ, clipCycles, clipEnd } from '../../model/types';
import type { Clip, Pattern } from '../../model/types';
import { quantize, setPatternLength } from '../../state/editActions';
import { newEmptyClip, setLoop, updatePattern } from '../../state/songActions';
import { setArrange, setEditor, useApp } from '../../state/store';
import type { EditTool, TrackHeight } from '../../state/store';
import { useMaps } from '../hooks';
import * as I from '../icons';
import { DrumGrid, lanesFor } from '../editor/DrumGrid';
import { editorApi } from '../editor/editorApi';
import { PatternMini } from './ClipMini';
import styles from './EditorPane.module.css';

const HEAD = 184;
const MIN_ZOOM = 16;
const MAX_ZOOM = 2400;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

const TOOLS: { id: EditTool; name: string; key: string; icon: ReactNode }[] = [
  { id: 'select', name: 'Select', key: 'V', icon: <I.Pointer /> },
  { id: 'draw', name: 'Draw', key: 'B', icon: <I.Pencil /> },
  { id: 'erase', name: 'Erase', key: 'E', icon: <I.Eraser /> },
  { id: 'line', name: 'Line', key: 'L', icon: <I.LineTool /> },
];

const LANE_H: Record<Exclude<TrackHeight, 'fit'>, number> = { S: 18, M: 24, L: 32 };

export function EditorPane() {
  const song = useApp((s) => s.song);
  const editClipId = useApp((s) => s.editClipId);
  const focus = useApp((s) => s.focus);
  const clip = song.clips.find((c) => c.id === editClipId);
  const pattern = clip && song.patterns[clip.patternId];
  return (
    <section
      aria-label="Clip editor"
      className={`${styles.pane} ${focus === 'editor' ? styles.focused : ''}`}
      onPointerDownCapture={() => focus !== 'editor' && useApp.setState({ focus: 'editor' })}
    >
      {clip && pattern ? <Editor clip={clip} pattern={pattern} /> : <Empty />}
    </section>
  );
}

function Empty() {
  const song = useApp((s) => s.song);
  const trackId = useApp((s) => s.selectedTrackId) ?? song.tracks[0]?.id;
  const track = song.tracks.find((t) => t.id === trackId);
  return (
    <div className={styles.empty}>
      <p>Select a clip to edit its notes here.</p>
      <p className={styles.muted}>To start a riff from scratch, double-click an empty spot on a track, drag across one with the pencil (B), or:</p>
      <button
        className="btn btn-primary"
        disabled={!track}
        onClick={() => track && newEmptyClip(track.id, engine.meter.snapBar(engine.position(), 'floor'))}
      >
        <I.Plus /> New riff on {track?.name ?? 'a track'} at the playhead
      </button>
    </div>
  );
}

function Editor({ clip, pattern }: { clip: Clip; pattern: Pattern }) {
  const editor = useApp((s) => s.editor);
  const loop = useApp((s) => s.song.loop);
  const track = useApp((s) => s.song.tracks.find((t) => t.id === clip.trackId));
  const linked = useApp((s) => s.song.clips.filter((c) => c.patternId === pattern.id).length);
  const { meter } = useMaps();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [renaming, setRenaming] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A newly opened clip starts fitted to the width.
  const shown = useRef(clip.id);
  useEffect(() => {
    if (shown.current === clip.id) return;
    shown.current = clip.id;
    setEditor({ fitWidth: true });
  }, [clip.id]);

  const fitZoom = clampZoom(((Math.max(box.w, 400) - HEAD - 16) / pattern.lengthTicks) * PPQ);
  const zoom = editor.fitWidth ? fitZoom : editor.zoom;
  const ppt = zoom / PPQ;

  // Zooming keeps a point steady: the pointer for ⌘-scroll, otherwise the left edge.
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
  const zoomTo = (z: number, clientX?: number) => {
    const el = scrollRef.current;
    const z1 = clampZoom(z);
    if (el && clientX !== undefined) {
      const offset = Math.max(0, clientX - el.getBoundingClientRect().left - HEAD);
      nextScroll.current = Math.max(0, ((el.scrollLeft + offset) * z1) / zoom - offset);
    }
    setEditor({ zoom: z1, fitWidth: false });
  };
  useEffect(() => {
    editorApi.zoomBy = (f) => zoomTo(zoom * f);
    editorApi.fit = () => setEditor({ fitWidth: true });
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      zoomTo(zoom * Math.exp(-d * 0.01), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const lanes = lanesFor(pattern, editor.lanes, editor.lanesShown);
  const groupRules = editor.lanes === 'kit' ? Math.max(0, new Set(lanes.map((l) => l.group)).size - 1) : 0;
  const velH = Math.round(Math.max(44, Math.min(100, box.h * 0.2)));
  const laneH =
    editor.laneSize === 'fit'
      ? Math.max(14, Math.floor((box.h - 24 - velH - groupRules * 3 - 4) / Math.max(1, lanes.length)))
      : LANE_H[editor.laneSize];
  const gridTicks = GRIDS.find((g) => g.id === editor.grid)?.ticks ?? PPQ / 4;
  const barLen = barTicksFor(pattern.meter[0], pattern.meter[1]);
  const bars = pattern.lengthTicks / barLen;
  const end = clipEnd(clip);
  const loopingClip = loop.on && loop.start === clip.start && loop.end === end;
  const passes = clipCycles(clip);
  const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.title}>
          {renaming ? (
            <input
              className="input"
              autoFocus
              defaultValue={pattern.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== pattern.name) updatePattern(pattern.id, (p) => void (p.name = v));
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
                e.stopPropagation();
              }}
            />
          ) : (
            <h2 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {pattern.name}
            </h2>
          )}
          <span className={styles.muted}>
            {track?.name} · {fmt(bars)}-bar riff
            {passes > 1.005 ? ` ×${fmt(passes)}` : ''}
            {linked > 1 ? ` · linked ×${linked}` : ''}
          </span>
        </div>
        <div role="group" aria-label="Note tools" className={`seg ${styles.tools}`}>
          {TOOLS.map((t) => (
            <button key={t.id} aria-pressed={editor.tool === t.id} title={`${t.name} tool · ${t.key}`} onClick={() => setEditor({ tool: t.id })}>
              {t.icon}
              <span className={styles.toolName}>{t.name}</span>
            </button>
          ))}
        </div>
        <label className={styles.label}>
          Grid
          <select className="select" value={editor.grid} onChange={(e) => setEditor({ grid: e.target.value })}>
            {GRIDS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          title="Quantize the selection (or every hit) to the grid · Q"
          onClick={() => {
            const sel = useApp.getState().selectedHitIds;
            quantize(pattern.id, gridTicks, sel.length ? sel : null);
          }}
        >
          Quantize
        </button>
        <div className={styles.label} title="Length of the riff itself">
          Riff
          <div className={styles.stepper}>
            <button className="btn" aria-label="One bar shorter" disabled={bars <= 1} onClick={() => setPatternLength(pattern.id, Math.max(barLen, Math.ceil(bars - 1) * barLen))}>
              <I.Minus />
            </button>
            <span className="mono">
              {fmt(bars)} bar{bars === 1 ? '' : 's'}
            </span>
            <button className="btn" aria-label="One bar longer" onClick={() => setPatternLength(pattern.id, (Math.floor(bars) + 1) * barLen)}>
              <I.Plus />
            </button>
          </div>
        </div>
        <button
          className="btn"
          aria-pressed={loopingClip}
          title="Loop playback over this clip · ⌘L"
          onClick={() => setLoop(loopingClip ? { on: false } : { start: clip.start, end, on: true }, true)}
        >
          <I.Loop size={14} />
          Loop clip
        </button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Hide the clip editor" title="Hide · Tab" onClick={() => setArrange({ showDock: false })}>
          <I.Close size={12} />
        </button>
      </div>

      <div ref={scrollRef} className={styles.scroll}>
        <DrumGrid clip={clip} pattern={pattern} meter={meter} ppt={ppt} laneH={laneH} velH={velH} showGroups shown={editor.lanesShown} />
      </div>

      <div className={styles.footer}>
        <div className={styles.footGroup}>
          <span className={styles.footLabel}>Lanes</span>
          <div role="radiogroup" aria-label="Lane view" className="seg">
            <button role="radio" aria-checked={editor.lanes === 'kit'} onClick={() => setEditor({ lanes: 'kit' })} title="One lane per drum">
              Kit
            </button>
            <button role="radio" aria-checked={editor.lanes === 'raw'} onClick={() => setEditor({ lanes: 'raw' })} title="One lane per note number in the source file">
              Raw
            </button>
          </div>
          <div role="radiogroup" aria-label="Lanes shown" className="seg" title="Which lanes to list · H cycles">
            {(
              [
                ['used', 'Used'],
                ['common', 'Common'],
                ['all', 'All'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={editor.lanesShown === id} onClick={() => setEditor({ lanesShown: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.footGroup}>
          <span className={styles.footLabel}>Lane height</span>
          <div role="radiogroup" aria-label="Lane height" className="seg">
            {(['fit', 'S', 'M', 'L'] as TrackHeight[]).map((h) => (
              <button key={h} role="radio" aria-checked={editor.laneSize === h} onClick={() => setEditor({ laneSize: h })}>
                {h === 'fit' ? 'Fit' : h}
              </button>
            ))}
          </div>
        </div>
        <ZoomStrip scrollRef={scrollRef} pattern={pattern} ppt={ppt} onZoom={(z, scroll) => {
          nextScroll.current = scroll;
          if (clampZoom(z) === zoom && scrollRef.current) scrollRef.current.scrollLeft = scroll;
          setEditor({ zoom: clampZoom(z), fitWidth: false });
        }} />
        <div className={styles.footGroup} style={{ gap: 4 }}>
          <span className={styles.footLabel} style={{ marginRight: 4 }} title="⌘ scroll or pinch zooms at the pointer">
            Zoom
          </span>
          <button className={`btn ${styles.sq}`} aria-label="Zoom out" title="Zoom out · −" onClick={() => zoomTo(zoom / 1.4)}>
            <I.Minus />
          </button>
          <button className={`btn ${styles.sq}`} aria-label="Zoom in" title="Zoom in · =" onClick={() => zoomTo(zoom * 1.4)}>
            <I.Plus />
          </button>
          <button className="btn" aria-pressed={editor.fitWidth} title="Fit the riff to the width · F" onClick={() => setEditor({ fitWidth: true })}>
            Fit riff
          </button>
        </div>
      </div>
    </>
  );
}

/** The riff in a strip; the framed window is what the grid shows. Drag it to pan, drag its edges to zoom. */
function ZoomStrip({
  scrollRef,
  pattern,
  ppt,
  onZoom,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  pattern: Pattern;
  ppt: number;
  onZoom: (zoom: number, scrollLeft: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1 });
  const total = pattern.lengthTicks;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const px = total * ppt;
        const w = el.clientWidth - HEAD;
        setView({ left: Math.min(1, el.scrollLeft / px), width: Math.min(1, w / px) });
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, total, ppt]);

  const frac = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onDown = (e: RPointerEvent, what: 'window' | 'left' | 'right' | 'outside') => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const f0 = frac(e.clientX);
    const start = { ...view };
    if (what === 'outside') {
      const left = Math.max(0, Math.min(1 - start.width, f0 - start.width / 2));
      el.scrollLeft = left * total * ppt;
      start.left = left;
    }
    const lanesPx = el.clientWidth - HEAD;
    const move = (ev: PointerEvent) => {
      const d = frac(ev.clientX) - f0;
      if (what === 'window' || what === 'outside') {
        el.scrollLeft = Math.max(0, start.left + d) * total * ppt;
        return;
      }
      let left = start.left;
      let width: number;
      if (what === 'left') {
        left = Math.min(start.left + start.width - 0.02, Math.max(0, start.left + d));
        width = start.left + start.width - left;
      } else width = Math.max(0.02, Math.min(1 - start.left, start.width + d));
      const z = (lanesPx / (width * total)) * PPQ;
      onZoom(z, left * total * (z / PPQ));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={styles.strip} title="The whole riff · drag the window to pan, drag its edges to zoom" onPointerDown={(e) => onDown(e, 'outside')}>
      <div className={styles.stripMini}>
        <PatternMini pattern={pattern} />
      </div>
      <div className={styles.stripWindow} style={{ left: `${view.left * 100}%`, width: `${view.width * 100}%` }} onPointerDown={(e) => onDown(e, 'window')}>
        <span className={styles.stripEdge} style={{ left: -1 }} onPointerDown={(e) => onDown(e, 'left')} />
        <span className={styles.stripEdge} style={{ right: -1 }} onPointerDown={(e) => onDown(e, 'right')} />
      </div>
    </div>
  );
}
