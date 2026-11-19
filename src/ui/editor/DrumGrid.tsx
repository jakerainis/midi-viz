/**
 * The drum note grid: one lane per articulation (or per source note in raw mode), hits as velocity-coloured
 * blocks, and a velocity lane underneath. It shows the clip's whole riff; the parts this clip doesn't play
 * (cropped away, or outside its loop) are shaded but still there. Edits change the riff, so every linked copy
 * and every pass of the loop changes together.
 */
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { engine } from '../../audio/engine';
import { ARTICULATIONS, ART_BY_ID, GROUP_LABEL } from '../../model/kit';
import type { LaneGroup } from '../../model/kit';
import { GRIDS } from '../../model/timing';
import type { MeterMap } from '../../model/timing';
import { PPQ } from '../../model/types';
import type { Clip, Hit, Pattern } from '../../model/types';
import { clipCycles, loopLength, patternTickAt } from '../../model/types';
import { addHits, artForNote, deleteHits, moveHits, noteFor, setVelocities } from '../../state/editActions';
import { checkpoint, setEditor, useApp } from '../../state/store';
import type { LanesShown } from '../../state/store';
import { setClipLoop } from '../../state/songActions';
import { useFrame } from '../hooks';
import styles from './DrumGrid.module.css';

export interface Lane {
  key: string;
  label: string;
  sub: string;
  art?: string;
  note?: number;
  group?: LaneGroup;
  unmapped?: boolean;
}

export const velColor = (v: number) => (v > 112 ? 'var(--vel-4)' : v > 88 ? 'var(--vel-3)' : v > 56 ? 'var(--vel-2)' : 'var(--vel-1)');

/** Lanes to show for a pattern. */
/** Everyday drums, listed even when a riff doesn't use them yet. */
const COMMON = new Set(['kick', 'snare', 'tom1', 'tom2', 'tom3', 'tom4', 'tom5', 'hihat_closed', 'hihat_pedal', 'hihat_semiopen', 'hihat_wideopen', 'crash1', 'crash2', 'china1', 'ride_bow', 'ride_bell']);

export function lanesFor(pattern: Pattern, mode: 'kit' | 'raw', shown: LanesShown): Lane[] {
  if (mode === 'raw') {
    const notes = new Map<number, string | undefined>();
    for (const h of pattern.hits) if (h.note !== undefined) notes.set(h.note, h.art);
    for (const u of pattern.unmapped ?? []) notes.set(u.note, undefined);
    return [...notes.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([note, art]) => ({
        key: `n${note}`,
        label: art ? (ART_BY_ID[art]?.short ?? art) : 'No sound',
        sub: String(note),
        art,
        note,
        unmapped: !art,
      }));
  }
  const used = new Set(pattern.hits.map((h) => h.art));
  // An empty riff shows the everyday lanes even in "used" mode, or there'd be nowhere to draw.
  const show = shown === 'all' ? () => true : shown === 'used' && used.size > 0 ? (id: string) => used.has(id) : (id: string) => COMMON.has(id) || used.has(id);
  return ARTICULATIONS.filter((a) => show(a.id)).map((a) => ({
    key: a.id,
    label: a.short,
    sub: String(noteFor(pattern, a.id) ?? a.note),
    art: a.id,
    note: noteFor(pattern, a.id) ?? a.note,
    group: a.group,
  }));
}

const laneKeyOf = (h: Hit, mode: 'kit' | 'raw') => (mode === 'raw' ? `n${h.note}` : h.art);

export interface DrumGridProps {
  clip: Clip;
  pattern: Pattern;
  meter: MeterMap;
  /** Pixels per tick. */
  ppt: number;
  laneH: number;
  velH: number;
  showGroups?: boolean;
  shown: LanesShown;
}

export function DrumGrid({ clip, pattern, meter, ppt, laneH, velH, showGroups, shown }: DrumGridProps) {
  const editor = useApp((s) => s.editor);
  const selected = useApp((s) => s.selectedHitIds);
  const mode = editor.lanes;
  const lanes = useMemo(() => lanesFor(pattern, mode, shown), [pattern, mode, shown]);
  const gridTicks = GRIDS.find((g) => g.id === editor.grid)?.ticks ?? PPQ / 4;
  const len = pattern.lengthTicks;
  const width = len * ppt;
  const L = loopLength(clip);
  // The parts of the riff this clip plays; everything else is shaded.
  const played: [number, number][] = (() => {
    if (clip.length >= L) return [[clip.loopStart, clip.loopEnd]];
    const a = clip.loopStart + clip.offset;
    const b = a + clip.length;
    return b <= clip.loopEnd ? [[a, b]] : [[a, clip.loopEnd], [clip.loopStart, clip.loopStart + b - clip.loopEnd]];
  })();
  const shaded: [number, number][] = [];
  {
    let at = 0;
    for (const [a, b] of [...played].sort((x, y) => x[0] - y[0])) {
      if (a > at) shaded.push([at, a]);
      at = Math.max(at, b);
    }
    if (at < len) shaded.push([at, len]);
  }
  const HEAD = 184;
  // Groups (cymbals, hi-hat, snare, toms, kick) are separated by a thin rule rather than a header row.
  const GROUP_H = 3;
  const selSet = new Set(selected);
  const hitW = Math.max(6, Math.min(gridTicks * ppt - 2, 16));
  const inset = laneH < 18 ? 2 : 3;

  // Rows with group headers.
  const rows = useMemo(() => {
    const out: ({ kind: 'group'; label: string } | { kind: 'lane'; lane: Lane })[] = [];
    let g: string | undefined;
    for (const l of lanes) {
      if (showGroups && mode === 'kit' && l.group && l.group !== g) {
        if (g) out.push({ kind: 'group', label: GROUP_LABEL[l.group] });
        g = l.group;
      }
      out.push({ kind: 'lane', lane: l });
    }
    return out;
  }, [lanes, showGroups, mode]);

  const laneIndexOf = useMemo(() => new Map(lanes.map((l, i) => [l.key, i])), [lanes]);
  const laneTop = useMemo(() => {
    const m = new Map<string, number>();
    const groups: number[] = [];
    let y = 0;
    for (const r of rows) {
      if (r.kind === 'group') {
        if (y > 0) groups.push(y);
        y += GROUP_H;
      } else {
        m.set(r.lane.key, y);
        y += laneH;
      }
    }
    return { map: m, groups, height: y };
  }, [rows, laneH]);

  const notesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const inside = (pos: number) => pos >= clip.start && pos < clip.start + clip.length;
  // The playhead shows where in the riff the clip is, playing or stopped, whenever it's inside the clip.
  useFrame(() => {
    const pos = engine.position();
    const on = inside(pos);
    const x = on ? patternTickAt(clip, pos) * ppt : 0;
    for (const el of [playheadRef.current, capRef.current]) {
      if (!el) continue;
      el.style.display = on ? 'block' : 'none';
      if (on) el.style.transform = `translateX(${x}px)`;
    }
    const label = posRef.current;
    if (label) {
      const b = meter.bbt(pos);
      const pass = Math.floor((clip.offset + pos - clip.start) / L) + 1;
      const cycles = clipCycles(clip);
      const text = !on ? 'Playhead outside this clip' : cycles > 1.001 ? `Bar ${b.bar}.${b.beat} · pass ${pass} of ${Math.ceil(cycles - 1e-6)}` : `Bar ${b.bar}.${b.beat}`;
      if (label.textContent !== text) label.textContent = text;
    }
  });

  /** Click or drag the ruler to move the playhead to that point of the riff, in the pass it's in. ⌥ = off the grid. */
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pos0 = engine.position();
    const pass = inside(pos0) ? Math.floor((clip.offset + pos0 - clip.start) / L) : 0;
    const end = clip.start + clip.length;
    const seekAt = (clientX: number, free: boolean) => {
      const x = Math.max(0, clientX - el.getBoundingClientRect().left);
      let p = x / ppt;
      p = free ? Math.round(p) : Math.round(p / gridTicks) * gridTicks;
      p = Math.max(clip.loopStart, Math.min(clip.loopEnd - 1, p));
      let t = clip.start - clip.offset + pass * L + (p - clip.loopStart);
      if (t < clip.start) t += L;
      while (t >= end && t - L >= clip.start) t -= L;
      engine.seek(Math.max(clip.start, Math.min(end - 1, t)));
    };
    seekAt(e.clientX, e.altKey);
    drag((ev) => seekAt(ev.clientX, ev.altKey));
  };

  /** Drag the ends of the loop bracket to choose which part of the riff repeats. */
  const onBraceDown = (e: RPointerEvent, edge: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    checkpoint();
    const el = (e.currentTarget as HTMLElement).parentElement!;
    drag((ev) => {
      const x = Math.max(0, ev.clientX - el.getBoundingClientRect().left);
      const t = Math.round(x / ppt / gridTicks) * gridTicks;
      if (edge === 'start') setClipLoop(clip.id, Math.min(t, clip.loopEnd - gridTicks), clip.loopEnd, false);
      else setClipLoop(clip.id, clip.loopStart, Math.max(t, clip.loopStart + gridTicks), false);
    });
  };
  const velRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const local = (e: { clientX: number; clientY: number }, el: HTMLElement | null) => {
    const r = el!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const laneAtY = (y: number): Lane | undefined => {
    for (const l of lanes) {
      const top = laneTop.map.get(l.key)!;
      if (y >= top && y < top + laneH) return l;
    }
    return undefined;
  };
  const laneIndex = (key: string) => lanes.findIndex((l) => l.key === key);
  const snap = (tick: number, free: boolean) => (free ? Math.round(tick) : Math.floor(tick / gridTicks + 1e-6) * gridTicks);
  const snapRound = (tick: number) => Math.round(tick / gridTicks) * gridTicks;

  const select = (ids: string[]) => useApp.setState({ selectedHitIds: ids, editClipId: clip.id });

  const hitArtForLane = (l: Lane) => l.art ?? (l.note !== undefined ? artForNote(pattern, l.note) : undefined);

  // ---- note area ----
  const onNotesDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus?.();
    const { x, y } = local(e, notesRef.current);
    if (x >= len * ppt) return;
    const tick = x / ppt;
    const lane = laneAtY(y);
    const hit = lane && pattern.hits.find((h) => laneKeyOf(h, mode) === lane.key && x >= h.tick * ppt - 2 && x <= h.tick * ppt + hitW + 2);
    const tool = editor.tool;

    if (tool === 'erase') {
      checkpoint();
      const erased = new Set<string>();
      const eraseAt = (cx: number, cy: number) => {
        const t = cx / ppt;
        const l = laneAtY(cy);
        if (!l) return;
        const ids = pattern.hits.filter((h) => laneKeyOf(h, mode) === l.key && !erased.has(h.id) && Math.abs(h.tick - t) * ppt < Math.max(6, gridTicks * ppt * 0.6)).map((h) => h.id);
        ids.forEach((id) => erased.add(id));
        if (ids.length) deleteHits(pattern.id, ids, false);
      };
      eraseAt(x, y);
      drag((ev) => {
        const p = local(ev, notesRef.current);
        eraseAt(p.x, p.y);
      });
      return;
    }

    if (tool === 'draw' || tool === 'line') {
      if (hit && tool === 'draw') {
        deleteHits(pattern.id, [hit.id]);
        return;
      }
      if (!lane) return;
      const art = hitArtForLane(lane);
      if (!art) return;
      checkpoint();
      const painted = new Set<number>();
      const paintAt = (t: number) => {
        if (t < 0 || t >= len || painted.has(t)) return;
        painted.add(t);
        if (pattern.hits.some((h) => laneKeyOf(h, mode) === lane.key && h.tick === t)) return;
        addHits(pattern.id, [{ tick: t, art, vel: editor.lastVel, note: lane.note }], false);
        if (painted.size === 1) void engine.audition(art, editor.lastVel);
      };
      // Fill every grid step between pointer samples, so a quick drag doesn't skip cells.
      let last = snap(x / ppt, e.altKey);
      paintAt(last);
      drag((ev) => {
        const t = snap(local(ev, notesRef.current).x / ppt, ev.altKey);
        const step = t >= last ? gridTicks : -gridTicks;
        if (!ev.altKey) for (let u = last; step > 0 ? u <= t : u >= t; u += step) paintAt(u);
        else paintAt(t);
        last = t;
      });
      return;
    }

    // Select tool.
    if (hit) {
      let ids = selected;
      if (e.shiftKey || e.metaKey) ids = selSet.has(hit.id) ? selected.filter((i) => i !== hit.id) : [...selected, hit.id];
      else if (!selSet.has(hit.id)) ids = [hit.id];
      select(ids);
      if (!e.altKey || !selSet.has(hit.id)) void engine.audition(hit.art, hit.vel);
      if (!ids.includes(hit.id)) return;
      const orig = pattern.hits.filter((h) => ids.includes(h.id));
      let started = false;
      drag((ev) => {
        const p = local(ev, notesRef.current);
        const dx = p.x - x;
        const dy = p.y - y;
        if (!started && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        if (!started) checkpoint();
        started = true;
        const dt = ev.altKey ? Math.round(dx / ppt) : snapRound(hit.tick + dx / ppt) - hit.tick;
        const dl = Math.round(dy / laneH);
        moveHits(
          pattern.id,
          orig.map((h) => {
            const li = Math.max(0, Math.min(lanes.length - 1, laneIndex(laneKeyOf(h, mode)) + dl));
            const target = lanes[li];
            const art = target.art ?? (target.note !== undefined ? artForNote(pattern, target.note) : undefined) ?? h.art;
            return { id: h.id, tick: h.tick + dt, art, note: mode === 'raw' ? target.note : dl ? noteFor(pattern, art) : h.note };
          }),
          false,
        );
      });
      return;
    }

    // Empty: double-click adds a hit; drag selects with a box.
    if (e.detail === 2 && lane) {
      const art = hitArtForLane(lane);
      if (art) {
        const t = snap(tick, e.altKey);
        const [id] = addHits(pattern.id, [{ tick: t, art, vel: editor.lastVel, note: lane.note }]);
        select([id]);
        void engine.audition(art, editor.lastVel);
      }
      return;
    }
    const base = e.shiftKey ? selected : [];
    if (!e.shiftKey) select([]);
    drag((ev) => {
      const p = local(ev, notesRef.current);
      setMarquee({ x0: x, y0: y, x1: p.x, y1: p.y });
      const t0 = Math.min(x, p.x) / ppt;
      const t1 = Math.max(x, p.x) / ppt;
      const y0 = Math.min(y, p.y);
      const y1 = Math.max(y, p.y);
      const ids = pattern.hits
        .filter((h) => {
          const top = laneTop.map.get(laneKeyOf(h, mode));
          return top !== undefined && top + laneH > y0 && top < y1 && h.tick >= t0 - 2 && h.tick <= t1;
        })
        .map((h) => h.id);
      select([...new Set([...base, ...ids])]);
    }, () => setMarquee(null));
  };

  // ---- velocity lane ----
  const velArt = editor.velLane;
  const velHits = useMemo(() => {
    if (velArt) return pattern.hits.filter((h) => h.art === velArt);
    const selArts = new Set(pattern.hits.filter((h) => selSet.has(h.id)).map((h) => h.art));
    return selArts.size ? pattern.hits.filter((h) => selArts.has(h.art)) : pattern.hits;
  }, [pattern.hits, velArt, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const onVelDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { x, y } = local(e, velRef.current);
    const velAt = (cy: number) => Math.round(Math.max(1, Math.min(127, (1 - cy / velH) * 127)));
    const tol = Math.max(4, gridTicks * ppt * 0.5);
    checkpoint();
    const onlySel = selected.length > 0 && velHits.some((h) => selSet.has(h.id));
    const pool = onlySel ? velHits.filter((h) => selSet.has(h.id)) : velHits;
    if (editor.tool === 'line' || e.shiftKey) {
      // Ramp between the press and the pointer.
      const x0 = x;
      const v0 = velAt(y);
      const apply = (cx: number, cy: number) => {
        const v1 = velAt(cy);
        const [a, b] = cx >= x0 ? [x0, cx] : [cx, x0];
        const ids = pool.filter((h) => h.tick * ppt >= a - tol && h.tick * ppt <= b + tol).map((h) => h.id);
        setVelocities(
          pattern.id,
          (h) => {
            const f = b - a < 1 ? 1 : (h.tick * ppt - x0) / (cx - x0 || 1);
            return v0 + (v1 - v0) * Math.max(0, Math.min(1, f));
          },
          ids,
          false,
        );
        setLine({ x0, y0: y, x1: cx, y1: cy });
      };
      apply(x, y);
      drag((ev) => {
        const p = local(ev, velRef.current);
        apply(p.x, p.y);
      }, () => setLine(null));
      return;
    }
    // Paint: hits under the pointer take its height.
    const paint = (cx: number, cy: number) => {
      const ids = pool.filter((h) => Math.abs(h.tick * ppt - cx) <= tol).map((h) => h.id);
      if (ids.length) {
        const v = velAt(cy);
        setVelocities(pattern.id, () => v, ids, false);
        setEditor({ lastVel: v });
      }
    };
    paint(x, y);
    drag((ev) => {
      const p = local(ev, velRef.current);
      paint(p.x, p.y);
    });
  };
  const [line, setLine] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // ---- ruler: bars of the riff itself ----
  const beat = (PPQ * 4) / pattern.meter[1];
  const beats = Math.round(len / beat);
  const marks: { x: number; label: string; strong: boolean }[] = [];
  for (let b = 0; b < beats; b++) {
    const bar = Math.floor(b / pattern.meter[0]) + 1;
    const inBar = b % pattern.meter[0];
    const isBar = inBar === 0;
    const label = isBar ? String(bar) : beat * ppt < 22 ? '' : `.${inBar + 1}`;
    marks.push({ x: b * beat * ppt, label, strong: isBar });
  }
  // Drop labels that would overlap; bar numbers win over beat numbers.
  const kept: typeof marks = [];
  for (const m of marks) {
    if (!m.label) continue;
    const prev = kept[kept.length - 1];
    if (prev && m.x < prev.x + prev.label.length * 6.8 + 6) {
      if (m.strong && !prev.strong) kept[kept.length - 1] = m;
      continue;
    }
    kept.push(m);
  }
  const gridLines: { x: number; kind: 'bar' | 'beat' | 'sub' }[] = [];
  const subPx = gridTicks * ppt;
  for (let t = 0; t < len; t += subPx >= 6 ? gridTicks : beat) {
    const kind = t % (beat * pattern.meter[0]) === 0 ? 'bar' : t % beat === 0 ? 'beat' : 'sub';
    gridLines.push({ x: t * ppt, kind });
  }

  return (
    <div className={styles.grid} style={{ ['--head' as string]: `${HEAD}px` }}>
      {/* ruler */}
      <div className={styles.rulerRow}>
        <div className={styles.head}>
          <span ref={posRef} />
        </div>
        <div className={styles.ruler} style={{ width }} onPointerDown={onRulerDown} title="Click or drag to move the playhead (⌥ for off the grid) · Space plays from there">
          <div
            className={styles.brace}
            style={{ left: clip.loopStart * ppt, width: (clip.loopEnd - clip.loopStart) * ppt }}
            title="The part of the riff this clip repeats · drag the ends to change it"
          >
            <span className={styles.braceEdge} data-edge="start" onPointerDown={(e) => onBraceDown(e, 'start')} />
            <span className={styles.braceEdge} data-edge="end" onPointerDown={(e) => onBraceDown(e, 'end')} />
          </div>
          <div ref={capRef} className={styles.cap} />
          {kept.map((m, i) => (
            <span key={i} className={styles.mark} style={{ left: m.x, color: m.strong ? 'var(--text)' : undefined }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.heads}>
          {rows.map((r, i) =>
            r.kind === 'group' ? (
              <div key={`g${i}`} className={styles.groupHead} style={{ height: GROUP_H }} title={r.label} />
            ) : (
              <button
                key={r.lane.key}
                className={`${styles.laneHead} ${velArt === r.lane.art ? styles.laneHeadOn : ''} ${r.lane.unmapped ? styles.unmapped : ''}`}
                data-alt={(laneIndexOf.get(r.lane.key) ?? 0) % 2 === 1 || undefined}
                style={{ height: laneH, fontSize: laneH < 17 ? 11 : 12 }}
                title={r.lane.art ? 'Click to hear it and show its velocities' : 'This note has no sound in the map; assign it in Mapping'}
                onClick={() => {
                  if (r.lane.art) {
                    void engine.audition(r.lane.art, editor.lastVel);
                    setEditor({ velLane: velArt === r.lane.art ? null : r.lane.art });
                  }
                }}
              >
                <span className={styles.laneName}>{r.lane.label}</span>
                <span className={styles.laneNote}>{r.lane.sub}</span>
              </button>
            ),
          )}
        </div>
        <div
          ref={notesRef}
          className={`${styles.notes} ${styles[`tool_${editor.tool}`] ?? ''}`}
          style={{ width, height: laneTop.height }}
          onPointerDown={onNotesDown}
        >
          {gridLines.map((g, i) => (
            <div key={i} className={styles[`line_${g.kind}`]} style={{ left: g.x }} />
          ))}
          {laneTop.groups.map((y) => (
            <div key={`gr${y}`} className={styles.groupRule} style={{ top: y, height: GROUP_H }} />
          ))}
          {rows.map((r, i) => {
            if (r.kind === 'group') return null;
            const top = laneTop.map.get(r.lane.key)!;
            return <div key={`bg${i}`} className={styles.laneBg} data-alt={(laneIndexOf.get(r.lane.key) ?? 0) % 2 === 1 || undefined} style={{ top, height: laneH }} />;
          })}
          {shaded.map(([a, b]) => (
            <div key={`sh${a}`} className={styles.ghostShade} style={{ left: a * ppt, width: (b - a) * ppt }} title="This clip doesn't play this part of the riff" />
          ))}
          <div ref={playheadRef} className={styles.playhead} />
          {pattern.hits.map((h) => {
            const top = laneTop.map.get(laneKeyOf(h, mode));
            if (top === undefined || h.tick >= len) return null;
            return (
              <div
                key={h.id}
                className={`${styles.hit} ${selSet.has(h.id) ? styles.hitSel : ''}`}
                style={{ left: h.tick * ppt, top: top + inset, height: laneH - inset * 2, width: hitW, background: velColor(h.vel) }}
              />
            );
          })}
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

      {/* velocity lane */}
      <div className={styles.velRow}>
        <div className={`${styles.head} ${styles.velHead}`}>
          <span>Velocity · {velArt ? ART_BY_ID[velArt]?.short : velHits === pattern.hits ? 'All' : 'Selection'}</span>
          <span className={styles.velHint}>{editor.tool === 'line' ? 'Drag to ramp' : 'Drag to draw · ⇧ ramps'}</span>
        </div>
        <div ref={velRef} className={styles.vel} style={{ width, height: velH }} onPointerDown={onVelDown}>
          {gridLines.map((g, i) => (g.kind === 'sub' ? null : <div key={i} className={styles[`line_${g.kind}`]} style={{ left: g.x }} />))}
          <div className={styles.velGuide} style={{ top: velH * (1 - 64 / 127) }} />
          {shaded.map(([a, b]) => (
            <div key={`sh${a}`} className={styles.ghostShade} style={{ left: a * ppt, width: (b - a) * ppt }} />
          ))}
          {velHits.map((h) =>
            h.tick < len ? (
              <div
                key={h.id}
                className={`${styles.velBar} ${selSet.has(h.id) ? styles.hitSel : ''}`}
                style={{ left: h.tick * ppt, width: Math.max(3, hitW - 3), height: (h.vel / 127) * (velH - 2), background: velColor(h.vel) }}
                title={`${ART_BY_ID[h.art]?.short} · ${h.vel}`}
              />
            ) : null,
          )}
          {line && (
            <svg className={styles.velLine} width={width} height={velH} aria-hidden="true">
              <line x1={line.x0} y1={line.y0} x2={line.x1} y2={line.y1} stroke="var(--select)" strokeWidth="2" strokeDasharray="5 4" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pointer-move/up on the window for a drag that started in a pointerdown handler. */
function drag(move: (e: PointerEvent) => void, end?: () => void) {
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    end?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
