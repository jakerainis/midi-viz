/**
 * The arrangement: ruler (scrub + loop), sections, tempo lane and tracks of clips, all in one scroll container so
 * they pan and zoom together. Row headers stick to the left, the top rows stick to the top.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPointerEvent, RefObject } from 'react';
import { engine } from '../../audio/engine';
import { useTransport } from '../../audio/bridge';
import { clipCycles, clipEnd, clipWraps, loopLength, PPQ, uid } from '../../model/types';
import type { Clip, Section, Song, Track } from '../../model/types';
import { GRIDS } from '../../model/timing';
import type { MeterMap } from '../../model/timing';
import { songEnd } from '../../model/compile';
import { checkpoint, edit, setArrange, TRACK_HEIGHTS, useApp } from '../../state/store';
import type { Snap } from '../../state/store';
import {
  addTrack,
  changeTempoSegment,
  colorForPattern,
  insertPattern,
  insertRiff,
  moveClips,
  newEmptyClip,
  patternUses,
  removeTempoPoint,
  setClipLength,
  setLoop,
  setTempoAt,
  splitClip,
  trimClipStart,
  updateSection,
  updateTrack,
} from '../../state/songActions';
import { useFrame, useMaps } from '../hooks';
import * as I from '../icons';
import { ClipMini } from './ClipMini';
import { drag, endDrag, isOurDrag, PATTERN_MIME, RIFF_MIME } from './dnd';
import styles from './Arrange.module.css';

export const HEAD_W = 184;
const TOP_H = 28 + 28 + 30 + 3;
const ADD_ROW_H = 36;

/** Snaps a tick to the arrange grid. ⌘ while dragging turns snapping off. */
export function snapTick(tick: number, snap: Snap, meter: MeterMap, mode: 'round' | 'floor' = 'round') {
  if (snap === 'bar') return meter.snapBar(tick, mode);
  if (snap === 'beat') return meter.snapBeat(tick, mode);
  if (snap === 'off') return Math.round(tick);
  // A note value, counted from the bar line so it stays on the grid after a time-signature change.
  const g = GRIDS.find((x) => x.id === snap)?.ticks ?? PPQ / 4;
  const barStart = meter.snapBar(tick, 'floor');
  const n = (tick - barStart) / g;
  return barStart + (mode === 'round' ? Math.round(n) : Math.floor(n + 1e-9)) * g;
}

/** Ticks shown: the song plus room to keep building. */
const fmtPasses = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2).replace(/0$/, ''));

export function timelineTicks(song: Song, meter: MeterMap) {
  const end = Math.max(songEnd(song), song.loop.end, PPQ * 4 * 8);
  return meter.tickOfBar(Math.ceil(meter.barAt(end)) + 16);
}

export function Timeline({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const song = useApp((s) => s.song);
  const zoom = useApp((s) => s.arrange.zoom);
  const trackHeight = useApp((s) => s.arrange.trackHeight);
  const snap = useApp((s) => s.arrange.snap);
  const tool = useApp((s) => s.arrange.tool);
  const follow = useApp((s) => s.arrange.follow);
  const selected = useApp((s) => s.selectedClipIds);
  const selectedTrackId = useApp((s) => s.selectedTrackId);
  const selectedSectionId = useApp((s) => s.selectedSectionId);
  const { meter } = useMaps();
  const { playing, mode } = useTransport();

  const ppt = zoom / PPQ; // pixels per tick
  const total = timelineTicks(song, meter);
  const [viewH, setViewH] = useState(400);
  const [viewW, setViewW] = useState(800);
  const lanesW = Math.max(total * ppt, viewW - HEAD_W);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewH(el.clientHeight);
      setViewW(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const rowH =
    trackHeight === 'fit'
      ? Math.max(40, Math.floor((viewH - TOP_H - ADD_ROW_H - 48) / Math.max(1, song.tracks.length)))
      : TRACK_HEIGHTS[trackHeight];

  const contentRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  /** Tick under a client x. */
  const tickAt = (clientX: number) => {
    const left = (contentRef.current?.getBoundingClientRect().left ?? 0) + HEAD_W;
    return Math.max(0, (clientX - left) / ppt);
  };
  const trackAt = (clientY: number): Track | undefined => {
    for (const t of song.tracks) {
      const r = rowRefs.current.get(t.id)?.getBoundingClientRect();
      if (r && clientY >= r.top && clientY < r.bottom) return t;
    }
    const first = rowRefs.current.get(song.tracks[0]?.id)?.getBoundingClientRect();
    if (first && clientY < first.top) return song.tracks[0];
    return song.tracks[song.tracks.length - 1];
  };

  // ---- playhead + follow ----
  const playheadRef = useRef<HTMLDivElement>(null);
  const followPaused = useRef(false);
  useEffect(() => {
    if (playing) followPaused.current = false;
  }, [playing]);
  useFrame(() => {
    const t = engine.position();
    const x = t * ppt;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
    const el = scrollRef.current;
    if (el && follow && !followPaused.current && engine.playing && mode === 'song') {
      const w = el.clientWidth - HEAD_W;
      if (x < el.scrollLeft || x > el.scrollLeft + w - 24) el.scrollLeft = Math.max(0, x - 40);
    }
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey && (e.deltaX !== 0 || e.shiftKey)) followPaused.current = true;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  // ---- grid ----
  const barPx = meter.barLength(0) * ppt;
  const labelEvery = barPx >= 40 ? 1 : barPx >= 20 ? 2 : barPx >= 10 ? 4 : barPx >= 5 ? 8 : 16;
  const grid = useMemo(() => {
    const lines: { x: number; kind: 'bar' | 'beat' }[] = [];
    const labels: { x: number; n: number }[] = [];
    const bars = Math.ceil(meter.barAt(total));
    for (let b = 0; b <= bars; b++) {
      const tick = meter.tickOfBar(b);
      const x = tick * ppt;
      if (b % labelEvery === 0) labels.push({ x, n: b + 1 });
      if (labelEvery <= 2 || b % labelEvery === 0) lines.push({ x, kind: 'bar' });
      const m = meter.meterAt(tick);
      const beat = (PPQ * 4) / m.den;
      if (beat * ppt >= 14) for (let k = 1; k < m.num; k++) lines.push({ x: (tick + k * beat) * ppt, kind: 'beat' });
    }
    return { lines, labels };
  }, [meter, total, ppt, labelEvery]);

  const loop = song.loop;

  // ---- ruler: scrub + loop band ----
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const inBand = e.clientY - rect.top < 9;
    const start = tickAt(e.clientX);
    if (inBand) {
      const a = meter.snapBar(start, 'floor');
      let moved = false;
      const move = (ev: PointerEvent) => {
        const t = tickAt(ev.clientX);
        if (!moved && Math.abs(t - start) * ppt < 3) return;
        if (!moved) checkpoint();
        moved = true;
        const b = t >= a ? meter.snapBar(t, 'round') : meter.snapBar(t, 'floor');
        const [s0, s1] = b >= a ? [a, Math.max(b, meter.tickOfBar(meter.barAt(a) + 1))] : [b, meter.tickOfBar(meter.barAt(a) + 1)];
        setLoop({ start: s0, end: s1, on: true });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!moved) {
          // Click on the band: toggle loop if inside it, else move the loop to this bar.
          if (start >= loop.start && start < loop.end) setLoop({ on: !loop.on }, true);
          else {
            const len = loop.end - loop.start;
            setLoop({ start: a, end: a + len, on: true }, true);
          }
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const seek = (clientX: number, alt: boolean) => {
      const t = tickAt(clientX);
      engine.seek(alt || snap === 'off' ? Math.round(t) : snapTick(t, snap === 'bar' ? 'beat' : snap, meter));
    };
    seek(e.clientX, e.altKey);
    const move = (ev: PointerEvent) => seek(ev.clientX, ev.altKey);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- clips: select, move, copy, repeat-stretch, split ----
  const [stretch, setStretch] = useState<{ id: string; label: string } | null>(null);
  const [drawing, setDrawing] = useState<{ trackId: string; start: number; end: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const onClipDown = (e: RPointerEvent, clip: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'split') {
      splitClip(clip.id, e.metaKey ? Math.round(tickAt(e.clientX)) : snapTick(tickAt(e.clientX), snap, meter));
      return;
    }
    let sel = selected;
    if (e.shiftKey || e.metaKey) {
      sel = selected.includes(clip.id) ? selected.filter((x) => x !== clip.id) : [...selected, clip.id];
    } else if (!selected.includes(clip.id)) sel = [clip.id];
    useApp.setState({ selectedClipIds: sel, editClipId: clip.id, selectedTrackId: clip.trackId, selectedSectionId: null, selectedHitIds: [] });
    if (!sel.includes(clip.id)) return;

    const x0 = e.clientX;
    const y0 = e.clientY;
    const trackIndex = (id: string) => song.tracks.findIndex((t) => t.id === id);
    let moving = sel.map((id) => song.clips.find((c) => c.id === id)!).filter(Boolean);
    let primary = clip;
    let started = false;
    const copy = e.altKey;
    const linkedCopy = e.altKey && e.shiftKey;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
        started = true;
        if (copy) {
          // ⌥-drag copies (⌥⇧ makes linked copies); the copies move, the originals stay.
          checkpoint();
          const ids = moving.map((c) => c.id);
          const map = new Map<string, string>();
          edit(
            (s) => {
              for (const c of moving) {
                const id = uid('c');
                map.set(c.id, id);
                let patternId = c.patternId;
                if (!linkedCopy) {
                  patternId = uid('p');
                  s.patterns[patternId] = { ...structuredClone(song.patterns[c.patternId]), id: patternId };
                }
                s.clips.push({ ...structuredClone(c), id, patternId });
              }
            },
            { history: false },
          );
          moving = ids.map((id) => ({ ...song.clips.find((c) => c.id === id)!, id: map.get(id)! }));
          primary = { ...primary, id: map.get(primary.id)! };
          useApp.setState({ selectedClipIds: moving.map((c) => c.id), editClipId: primary.id });
        } else checkpoint();
      }
      const free = ev.metaKey;
      const dt = (ev.clientX - x0) / ppt;
      const target = free ? Math.round(clip.start + dt) : snapTick(clip.start + dt, snap, meter);
      let delta = target - clip.start;
      const minStart = Math.min(...moving.map((c) => c.start));
      if (minStart + delta < 0) delta = -minStart;
      const over = trackAt(ev.clientY);
      const dTrack = over ? trackIndex(over.id) - trackIndex(clip.trackId) : 0;
      const n = song.tracks.length;
      moveClips(
        moving.map((c) => {
          const ti = Math.max(0, Math.min(n - 1, trackIndex(c.trackId) + dTrack));
          return { id: c.id, start: c.start + delta, trackId: song.tracks[ti].id };
        }),
        false,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * Clip edges. The right edge sets the length: shorter crops the riff, longer repeats its loop (any length, not
   * just whole passes). The left edge trims or reveals the start; the notes stay where they are. ⌘ = no snap.
   */
  const onEdgeDown = (e: RPointerEvent, clip: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    checkpoint();
    useApp.setState({ selectedClipIds: [clip.id], editClipId: clip.id, selectedTrackId: clip.trackId, selectedHitIds: [] });
    const L = loopLength(clip);
    const end = clip.start + clip.length;
    const move = (ev: PointerEvent) => {
      const raw = tickAt(ev.clientX);
      const t = ev.metaKey ? Math.round(raw) : snapTick(raw, snap, meter);
      if (edge === 'end') {
        const len = Math.max(PPQ / 4, t - clip.start);
        setClipLength(clip.id, len, false);
        setStretch({ id: clip.id, label: lengthLabel(len, L) });
      } else {
        const start = Math.min(t, end - PPQ / 4);
        trimClipStart(clip.id, start, false);
        setStretch({ id: clip.id, label: lengthLabel(end - Math.max(0, start), L) });
      }
    };
    const up = () => {
      setStretch(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const lengthLabel = (len: number, L: number) => {
    const bars = len / meter.barLength(0);
    const passes = len / L;
    const b = Number.isInteger(Math.round(bars * 100) / 100) ? String(Math.round(bars)) : bars.toFixed(2);
    return Math.abs(passes - 1) < 1e-6 ? `${b} bar${b === '1' ? '' : 's'}` : `${b} bars · ×${fmtPasses(passes)}`;
  };

  const onLaneDown = (e: RPointerEvent, track: Track) => {
    if (e.button !== 0) return;
    const t = tickAt(e.clientX);
    // Pencil: drag across a track to draw a new empty riff (a click makes one bar). Double-click does the same.
    if (tool === 'pencil' || e.detail === 2) {
      const a = meter.snapBar(t, 'floor');
      const span = (x: number) => {
        const b = Math.max(meter.snapBar(tickAt(x), 'round'), a + meter.barLength(a));
        return { trackId: track.id, start: a, end: b };
      };
      setDrawing(span(e.clientX));
      let last = span(e.clientX);
      const move = (ev: PointerEvent) => {
        last = span(ev.clientX);
        setDrawing(last);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDrawing(null);
        newEmptyClip(track.id, last.start, last.end - last.start);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    useApp.setState({ selectedTrackId: track.id, selectedSectionId: null });
    // Marquee select.
    const rect = contentRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const base = e.shiftKey ? selected : [];
    if (!e.shiftKey) useApp.setState({ selectedClipIds: [] });
    let started = false;
    const move = (ev: PointerEvent) => {
      const r = contentRef.current!.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      if (!started && Math.abs(x - sx) < 4 && Math.abs(y - sy) < 4) return;
      started = true;
      setMarquee({ x0: sx, y0: sy, x1: x, y1: y });
      const t0 = (Math.min(sx, x) - HEAD_W) / ppt;
      const t1 = (Math.max(sx, x) - HEAD_W) / ppt;
      const top = Math.min(sy, y) + r.top;
      const bottom = Math.max(sy, y) + r.top;
      const hitTracks = new Set(
        song.tracks
          .filter((tr) => {
            const rr = rowRefs.current.get(tr.id)?.getBoundingClientRect();
            return rr && rr.bottom > top && rr.top < bottom;
          })
          .map((tr) => tr.id),
      );
      const ids = song.clips
        .filter((c) => hitTracks.has(c.trackId) && c.start < t1 && clipEnd(c, song.patterns[c.patternId]) > t0)
        .map((c) => c.id);
      useApp.setState({ selectedClipIds: [...new Set([...base, ...ids])] });
    };
    const up = () => {
      setMarquee(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- drop riffs from the library ----
  const [ghost, setGhost] = useState<{ trackId: string | 'new'; start: number; len: number } | null>(null);
  const dropTarget = (e: DragEvent, trackId: string | 'new') => {
    const start = snapTick(tickAt(e.clientX), snap === 'off' ? '1/16' : snap, meter, 'floor');
    return { trackId, start, len: drag.lengthTicks ?? meter.barLength(start) };
  };
  const onDragOver = (e: DragEvent, trackId: string | 'new') => {
    if (!isOurDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const g = dropTarget(e, trackId);
    if (!ghost || ghost.start !== g.start || ghost.trackId !== g.trackId || ghost.len !== g.len) setGhost(g);
  };
  const onDrop = async (e: DragEvent, trackId: string | 'new') => {
    e.preventDefault();
    const key = e.dataTransfer.getData(RIFF_MIME);
    const patternId = e.dataTransfer.getData(PATTERN_MIME);
    const { start } = dropTarget(e, trackId);
    setGhost(null);
    endDrag();
    const tid = trackId === 'new' ? addTrack() : trackId;
    if (key) await insertRiff(key, tid, start);
    else if (patternId) insertPattern(patternId, tid, start);
  };

  // ---- inline renames ----
  const [renaming, setRenaming] = useState<{ kind: 'track' | 'section'; id: string } | null>(null);

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost(null);
      }}
    >
      <div ref={contentRef} className={styles.canvas} style={{ width: HEAD_W + lanesW }}>
        <div className={styles.top}>
          {/* Ruler */}
          <div className={styles.row} style={{ height: 28 }}>
            <div className={styles.head}>Bars</div>
            <div className={styles.ruler} style={{ width: lanesW }} onPointerDown={onRulerDown} title="Click or drag to move the playhead · drag the top strip to set the loop">
              <div
                className={styles.loopBand}
                style={{ left: loop.start * ppt, width: (loop.end - loop.start) * ppt, opacity: loop.on ? 1 : 0.35 }}
              />
              {grid.labels.map((l) => (
                <span key={l.n} className={styles.barNum} style={{ left: l.x }}>
                  {l.n}
                </span>
              ))}
              {meter.points.slice(1).map((p) => (
                <span key={p.tick} className={styles.meterMark} style={{ left: p.tick * ppt }} title="Time signature change">
                  {p.num}/{p.den}
                </span>
              ))}
            </div>
          </div>
          {/* Sections */}
          <div className={styles.row} style={{ height: 28 }}>
            <div className={`${styles.head} ${styles.headSplit}`}>
              Sections<span className="mono">⇧M</span>
            </div>
            <div className={styles.lane} style={{ width: lanesW }}>
              {song.sections.map((s) => (
                <SectionBlock
                  key={s.id}
                  section={s}
                  ppt={ppt}
                  meter={meter}
                  selected={s.id === selectedSectionId}
                  renaming={renaming?.kind === 'section' && renaming.id === s.id}
                  onRename={(on) => setRenaming(on ? { kind: 'section', id: s.id } : null)}
                  neighbours={song.sections}
                />
              ))}
            </div>
          </div>
          {/* Tempo */}
          <div className={styles.row} style={{ height: 30 }}>
            <div className={`${styles.head} ${styles.headSplit}`}>
              Tempo<span className="mono">{`${meter.points[0].num}/${meter.points[0].den}`}</span>
            </div>
            <TempoLane song={song} ppt={ppt} width={lanesW} meter={meter} total={total} />
          </div>
        </div>

        <div className={styles.tracks}>
          <div className={styles.grid} style={{ left: HEAD_W, width: lanesW }} aria-hidden="true">
            {grid.lines.map((l, i) => (
              <div key={i} className={l.kind === 'bar' ? styles.barLine : styles.beatLine} style={{ left: l.x }} />
            ))}
            {loop.on && <div className={styles.loopWash} style={{ left: loop.start * ppt, width: (loop.end - loop.start) * ppt }} />}
          </div>

          {song.tracks.map((t) => (
            <div
              key={t.id}
              ref={(el) => {
                if (el) rowRefs.current.set(t.id, el);
                else rowRefs.current.delete(t.id);
              }}
              className={styles.trackRow}
              style={{ height: rowH }}
            >
              <TrackHead
                track={t}
                selected={t.id === selectedTrackId}
                renaming={renaming?.kind === 'track' && renaming.id === t.id}
                onRename={(on) => setRenaming(on ? { kind: 'track', id: t.id } : null)}
                tracks={song.tracks}
              />
              <div
                className={`${styles.lane} ${tool === 'pencil' ? styles.pencil : ''}`}
                style={{ width: lanesW }}
                onPointerDown={(e) => onLaneDown(e, t)}
                onDragOver={(e) => onDragOver(e, t.id)}
                onDrop={(e) => void onDrop(e, t.id)}
              >
                {song.clips
                  .filter((c) => c.trackId === t.id)
                  .map((c) => {
                    const p = song.patterns[c.patternId];
                    if (!p) return null;
                    const isSel = selected.includes(c.id);
                    const muted = t.mute || (song.tracks.some((x) => x.solo) && !t.solo);
                    const linked = patternUses(song, c.patternId) > 1;
                    const w = c.length * ppt;
                    const passes = clipCycles(c);
                    const cropped = c.loopStart > 0 || c.loopEnd < p.lengthTicks || (passes < 1 - 1e-6) || c.offset > 0;
                    const wraps = loopLength(c) * ppt > 6 ? clipWraps(c) : [];
                    return (
                      <div
                        key={c.id}
                        className={`${styles.clip} ${isSel ? styles.clipSel : ''} ${tool === 'split' ? styles.splitCursor : ''}`}
                        style={{ left: c.start * ppt, width: w, background: colorForPattern(p), opacity: muted ? 0.45 : 1 }}
                        onPointerDown={(e) => onClipDown(e, c)}
                        onDoubleClick={() => {
                          useApp.setState({ editClipId: c.id, focus: 'editor' });
                          setArrange({ showDock: true });
                        }}
                        title={`${p.name} · ${p.source ? `${p.source.pack.trim()}/${p.source.file}` : 'Made here'} · drag the edges to crop or repeat`}
                      >
                        {wraps.slice(0, 256).map((x) => (
                          <div key={x} className={styles.divider} style={{ left: (x - c.start) * ppt }} />
                        ))}
                        <div className={styles.clipLabel}>
                          {linked && <I.Link />}
                          {cropped && <I.Scissors size={10} />}
                          <span className={styles.clipName}>{p.name}</span>
                          {Math.abs(passes - 1) > 1e-6 && passes > 1 && <span className={styles.badge}>×{fmtPasses(passes)}</span>}
                          {p.edited && <span className={styles.badge}>•</span>}
                        </div>
                        {rowH >= 40 && (
                          <div className={styles.clipHits}>
                            <ClipMini clip={c} pattern={p} />
                          </div>
                        )}
                        <div className={styles.edge} data-edge="start" title="Drag to trim the start" onPointerDown={(e) => onEdgeDown(e, c, 'start')} />
                        <div className={styles.edge} data-edge="end" title="Drag to crop, or past the end to repeat" onPointerDown={(e) => onEdgeDown(e, c, 'end')} />
                        {stretch?.id === c.id && <div className={styles.stretchTip}>{stretch.label}</div>}
                      </div>
                    );
                  })}
                {drawing?.trackId === t.id && (
                  <div className={styles.ghost} style={{ left: drawing.start * ppt, width: (drawing.end - drawing.start) * ppt }} />
                )}
                {ghost?.trackId === t.id && <div className={styles.ghost} style={{ left: ghost.start * ppt, width: ghost.len * ppt }} />}
              </div>
            </div>
          ))}

          <div className={styles.trackRow} style={{ height: ADD_ROW_H }}>
            <div className={styles.head}>
              <button className={styles.addTrack} onClick={() => addTrack()}>
                + Add track
              </button>
            </div>
            <div
              className={styles.dropZone}
              style={{ width: lanesW }}
              onDragOver={(e) => onDragOver(e, 'new')}
              onDrop={(e) => void onDrop(e, 'new')}
            >
              {ghost?.trackId === 'new' ? (
                <div className={styles.ghost} style={{ left: ghost.start * ppt, width: ghost.len * ppt }} />
              ) : song.clips.length === 0 ? (
                <span style={{ left: 16 }}>Drag riffs here from the library, or press Enter on one</span>
              ) : (
                <span style={{ left: 16 }}>Drop riffs here to start a new track</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.playheadWrap} style={{ left: HEAD_W }} aria-hidden="true">
          <div ref={playheadRef} className={styles.playhead}>
            <div className={styles.playheadCap} />
          </div>
        </div>

        {marquee && (
          <div
            className={styles.marquee}
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
      </div>
    </div>
  );
}

function TrackHead({
  track,
  selected,
  renaming,
  onRename,
  tracks,
}: {
  track: Track;
  selected: boolean;
  renaming: boolean;
  onRename: (on: boolean) => void;
  tracks: Track[];
}) {
  const clipCount = useApp((s) => s.song.clips.reduce((n, c) => n + (c.trackId === track.id ? 1 : 0), 0));
  const soloedElsewhere = tracks.some((t) => t.solo) && !track.solo;
  const sub = track.mute ? 'Muted' : soloedElsewhere ? 'Silent while another track is soloed' : `${clipCount} clip${clipCount === 1 ? '' : 's'}`;
  return (
    <div
      className={`${styles.head} ${styles.trackHead} ${selected ? styles.trackHeadSel : ''}`}
      style={{ borderLeftColor: track.color }}
      onPointerDown={() => useApp.setState({ selectedTrackId: track.id, selectedClipIds: [], selectedSectionId: null })}
    >
      <div className={styles.trackTop}>
        {renaming ? (
          <input
            className={`input ${styles.renameInput}`}
            autoFocus
            onFocus={(e) => e.target.select()}
            defaultValue={track.name}
            onBlur={(e) => {
              if (e.target.value.trim()) updateTrack(track.id, { name: e.target.value.trim() });
              onRename(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') onRename(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <span className={styles.trackName} style={{ color: track.mute ? 'var(--muted)' : undefined }} onDoubleClick={() => onRename(true)} title="Double-click to rename">
            {track.name}
          </span>
        )}
        <button
          className={styles.ms}
          aria-label={`Mute ${track.name}`}
          aria-pressed={track.mute}
          data-kind="mute"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateTrack(track.id, { mute: !track.mute })}
        >
          M
        </button>
        <button
          className={styles.ms}
          aria-label={`Solo ${track.name}`}
          aria-pressed={track.solo}
          data-kind="solo"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
      </div>
      <span className={styles.trackSub}>{sub}</span>
    </div>
  );
}

function SectionBlock({
  section,
  ppt,
  meter,
  selected,
  renaming,
  onRename,
  neighbours,
}: {
  section: Section;
  ppt: number;
  meter: MeterMap;
  selected: boolean;
  renaming: boolean;
  onRename: (on: boolean) => void;
  neighbours: Section[];
}) {
  const onEdge = (e: RPointerEvent, edge: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    checkpoint();
    const content = (e.currentTarget as HTMLElement).closest(`.${styles.lane}`)!.getBoundingClientRect();
    const prev = neighbours.filter((s) => s.end <= section.start && s.id !== section.id).reduce((m, s) => Math.max(m, s.end), 0);
    const next = neighbours.filter((s) => s.start >= section.end && s.id !== section.id).reduce((m, s) => Math.min(m, s.start), Infinity);
    const move = (ev: PointerEvent) => {
      const t = meter.snapBar((ev.clientX - content.left) / ppt);
      if (edge === 'start') updateSection(section.id, { start: Math.max(prev, Math.min(t, section.end - meter.barLength(section.end - 1))) }, false);
      else updateSection(section.id, { end: Math.min(next, Math.max(t, section.start + meter.barLength(section.start))) }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`${styles.section} ${selected ? styles.sectionSel : ''}`}
      style={{ left: section.start * ppt, width: (section.end - section.start) * ppt, borderLeftColor: section.color }}
      onPointerDown={(e) => {
        e.stopPropagation();
        useApp.setState({ selectedSectionId: section.id, selectedClipIds: [] });
        engine.seek(section.start);
      }}
      onDoubleClick={() => onRename(true)}
      title={`${section.name} · double-click to rename · ⌘L loops it`}
    >
      {renaming ? (
        <input
          className={styles.sectionInput}
          autoFocus
          onFocus={(e) => e.target.select()}
          defaultValue={section.name}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value.trim()) updateSection(section.id, { name: e.target.value.trim() });
            onRename(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') onRename(false);
            e.stopPropagation();
          }}
        />
      ) : (
        <span>{section.name}</span>
      )}
      <span className={styles.sectionEdge} data-edge="start" onPointerDown={(e) => onEdge(e, 'start')} />
      <span className={styles.sectionEdge} data-edge="end" onPointerDown={(e) => onEdge(e, 'end')} />
    </div>
  );
}

/** Tempo as steps. Drag a step up/down to change it, double-click to add a change at a bar, ⌥-click a step's start to remove it. */
function TempoLane({ song, ppt, width, meter, total }: { song: Song; ppt: number; width: number; meter: MeterMap; total: number }) {
  const pts = song.tempo;
  const bpms = pts.map((p) => p.bpm);
  const lo = Math.min(...bpms) - 12;
  const hi = Math.max(...bpms) + 12;
  const H = 30;
  const y = (bpm: number) => 5 + (1 - (bpm - lo) / (hi - lo)) * (H - 12);
  const laneRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ tick: number; x: number; bpm: number } | null>(null);

  const onSegDown = (e: RPointerEvent, i: number) => {
    e.stopPropagation();
    if (e.altKey) {
      removeTempoPoint(pts[i].tick);
      return;
    }
    const y0 = e.clientY;
    const b0 = pts[i].bpm;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dy = y0 - ev.clientY;
      if (!moved && Math.abs(dy) < 3) return;
      if (!moved) checkpoint();
      moved = true;
      const step = ev.shiftKey ? 0.1 : 1;
      changeTempoSegment(pts[i].tick, Math.round((b0 + dy * 0.5 * step) / step) * step, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) setEditing({ tick: pts[i].tick, x: pts[i].tick * ppt, bpm: pts[i].bpm });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={laneRef}
      className={styles.lane}
      style={{ width }}
      title="Drag a step to change tempo · click to type · double-click to add a change · ⌥-click to remove"
      onDoubleClick={(e) => {
        const r = laneRef.current!.getBoundingClientRect();
        const tick = meter.snapBar((e.clientX - r.left) / ppt, 'floor');
        let bpm = pts[0].bpm;
        for (const p of pts) if (p.tick <= tick) bpm = p.bpm;
        setTempoAt(tick, bpm);
        setEditing({ tick, x: tick * ppt, bpm });
      }}
    >
      {pts.map((p, i) => {
        const end = i + 1 < pts.length ? pts[i + 1].tick : total;
        const left = p.tick * ppt;
        return (
          <div key={p.tick}>
            <div className={styles.tempoSeg} style={{ left, width: (end - p.tick) * ppt, top: y(p.bpm) }} onPointerDown={(e) => onSegDown(e, i)} />
            <span className={styles.tempoLabel} style={{ left, top: y(p.bpm) > H / 2 ? 1 : 15 }}>
              {Number.isInteger(p.bpm) ? p.bpm : p.bpm.toFixed(1)}
            </span>
            {i > 0 && (
              <div
                className={styles.tempoStep}
                style={{ left, top: Math.min(y(pts[i - 1].bpm), y(p.bpm)), height: Math.abs(y(pts[i - 1].bpm) - y(p.bpm)) + 1.5 }}
              />
            )}
          </div>
        );
      })}
      {editing && (
        <input
          className={styles.tempoInput}
          style={{ left: editing.x }}
          type="number"
          step="0.1"
          min="20"
          max="400"
          autoFocus
          onFocus={(e) => e.target.select()}
          defaultValue={editing.bpm}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 20 && v <= 400) setTempoAt(editing.tick, v);
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(null);
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

