/**
 * The whole song in a strip. The framed window is what the timeline shows: drag it to pan, drag its edges to
 * zoom, click elsewhere to jump there.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, RefObject } from 'react';
import { engine } from '../../audio/engine';
import { PPQ, clipEnd } from '../../model/types';
import { colorForPattern } from '../../state/songActions';
import { useApp } from '../../state/store';
import { useFrame } from '../hooks';
import { HEAD_W } from './Timeline';
import styles from './Arrange.module.css';

export function Overview({
  scrollRef,
  total,
  onZoom,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  total: number;
  onZoom: (zoom: number, scrollLeft: number) => void;
}) {
  const song = useApp((s) => s.song);
  const zoom = useApp((s) => s.arrange.zoom);
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1 });

  // Track the timeline's scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const px = total * (zoom / PPQ);
        const w = el.clientWidth - HEAD_W;
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
  }, [scrollRef, total, zoom]);

  useFrame(() => {
    if (headRef.current) headRef.current.style.left = `${(engine.position() / total) * 100}%`;
  });

  const frac = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const lanesPx = () => (scrollRef.current?.clientWidth ?? 800) - HEAD_W;

  const onDown = (e: RPointerEvent, what: 'window' | 'left' | 'right' | 'outside') => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const f0 = frac(e.clientX);
    const start = { ...view };
    if (what === 'outside') {
      // Centre the window on the click, then keep dragging it.
      const left = Math.max(0, Math.min(1 - start.width, f0 - start.width / 2));
      el.scrollLeft = left * total * (zoom / PPQ);
      start.left = left;
    }
    const move = (ev: PointerEvent) => {
      const d = frac(ev.clientX) - f0;
      if (what === 'window' || what === 'outside') {
        el.scrollLeft = Math.max(0, start.left + d) * total * (useApp.getState().arrange.zoom / PPQ);
        return;
      }
      // Edges: the visible span changes, so the zoom does.
      let left = start.left;
      let width: number;
      if (what === 'left') {
        left = Math.min(start.left + start.width - 0.01, Math.max(0, start.left + d));
        width = start.left + start.width - left;
      } else width = Math.max(0.01, Math.min(1 - start.left, start.width + d));
      const z = (lanesPx() / (width * total)) * PPQ;
      onZoom(z, left * total * (z / PPQ));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tracks = song.tracks.slice(0, 4);
  const laneH = 26 / Math.max(1, tracks.length);
  return (
    <div ref={ref} className={styles.overview} title="Song overview · drag the window to pan, drag its edges to zoom" onPointerDown={(e) => onDown(e, 'outside')}>
      {tracks.map((t, ti) =>
        song.clips
          .filter((c) => c.trackId === t.id)
          .map((c) => {
            const p = song.patterns[c.patternId];
            return (
              <div
                key={c.id}
                className={styles.ovBlock}
                style={{
                  left: `${(c.start / total) * 100}%`,
                  width: `${((clipEnd(c, p) - c.start) / total) * 100}%`,
                  top: 3 + ti * laneH,
                  height: Math.max(2, laneH - 2),
                  background: colorForPattern(p),
                  opacity: t.mute ? 0.4 : 1,
                }}
              />
            );
          }),
      )}
      <div ref={headRef} className={styles.ovPlayhead} />
      <div
        className={styles.ovWindow}
        style={{ left: `${view.left * 100}%`, width: `${view.width * 100}%` }}
        onPointerDown={(e) => onDown(e, 'window')}
      >
        <span className={styles.ovEdge} style={{ left: -1 }} onPointerDown={(e) => onDown(e, 'left')} />
        <span className={styles.ovEdge} style={{ right: -1 }} onPointerDown={(e) => onDown(e, 'right')} />
      </div>
    </div>
  );
}
