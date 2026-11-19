/** Riff library: browse packs and families, search, preview at song tempo, drag or Enter to place. */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { engine } from '../../audio/engine';
import { useTransport } from '../../audio/bridge';
import type { Pack, Riff } from '../../model/library';
import type { Pattern } from '../../model/types';
import { PPQ } from '../../model/types';
import { patternForRiff } from '../../state/riffs';
import { insertRiff, replaceClipRiff } from '../../state/songActions';
import { setLibrary, useApp } from '../../state/store';
import { useFrame } from '../hooks';
import * as I from '../icons';
import { PatternMini } from './ClipMini';
import { endDrag, startPatternDrag, startRiffDrag } from './dnd';
import styles from './Library.module.css';

/** Riffs in display order, for ↑/↓ browsing. Written after each render of the list. */
const visible: { riffs: Riff[] } = { riffs: [] };

const previewBpm = () => Math.round(engine.tempo.bpmAt(engine.position()) * 10) / 10;

export const libraryApi = {
  move(dir: 1 | -1) {
    const { activeKey } = useApp.getState().library;
    const list = visible.riffs;
    if (!list.length) return;
    const i = list.findIndex((r) => r.key === activeKey);
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))];
    setLibrary({ activeKey: next.key });
    document.querySelector(`[data-riff="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' });
    // Keep previewing while browsing.
    if (engine.getSnapshot().mode === 'preview') void libraryApi.preview(next.key);
  },
  async preview(key = useApp.getState().library.activeKey) {
    if (!key) return;
    const snap = engine.getSnapshot();
    if (snap.mode === 'preview' && snap.previewKey === key && snap.playing) {
      engine.stopPreview();
      return;
    }
    const p = await patternForRiff(key);
    void engine.previewPattern(key, p, previewBpm());
  },
  async insert() {
    const st = useApp.getState();
    const key = st.library.activeKey;
    if (!key) return;
    const trackId = st.selectedTrackId ?? st.song.tracks[0]?.id;
    if (!trackId) return;
    engine.stopPreview();
    const at = engine.meter.snapBar(engine.position(), 'floor');
    await insertRiff(key, trackId, at);
  },
  async replace() {
    const st = useApp.getState();
    const key = st.library.activeKey;
    const clip = st.selectedClipIds[0];
    if (key && clip) await replaceClipRiff(clip, key);
  },
  focusSearch() {
    document.querySelector<HTMLInputElement>('#library-search')?.focus();
  },
};

function matches(r: Riff, words: string[], bpmMin: number | null, bpmMax: number | null) {
  if (bpmMin !== null && (r.bpm ?? 0) < bpmMin) return false;
  if (bpmMax !== null && (r.bpm ?? 999) > bpmMax) return false;
  if (!words.length) return true;
  const hay = `${r.pack} ${r.family} ${r.name} ${r.bpm ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function Library() {
  const lib = useApp((s) => s.library);
  const [filterOpen, setFilterOpen] = useState(false);
  const words = lib.query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = words.length > 0 || lib.bpmMin !== null || lib.bpmMax !== null;
  const total = useMemo(() => lib.packs.reduce((n, p) => n + p.count, 0), [lib.packs]);

  return (
    <div className={styles.lib}>
      <div className={styles.head}>
        <h2>Library</h2>
        <div className="seg" role="radiogroup" aria-label="Library source">
          <button role="radio" aria-checked={lib.tab === 'packs'} onClick={() => setLibrary({ tab: 'packs' })}>
            Packs
          </button>
          <button role="radio" aria-checked={lib.tab === 'project'} onClick={() => setLibrary({ tab: 'project' })}>
            In project
          </button>
        </div>
      </div>

      {lib.tab === 'packs' ? (
        <>
          <label className={styles.search}>
            <I.Search style={{ color: 'var(--muted)' }} />
            <span className="sr-only">Search riffs</span>
            <input
              id="library-search"
              type="search"
              placeholder={`Search ${total.toLocaleString()} riffs`}
              value={lib.query}
              onChange={(e) => setLibrary({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  libraryApi.move(e.key === 'ArrowDown' ? 1 : -1);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  void (e.altKey ? libraryApi.replace() : libraryApi.insert());
                } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
            />
            <kbd className="kbd">/</kbd>
          </label>
          <div className={styles.chips}>
            {(lib.bpmMin !== null || lib.bpmMax !== null) && (
              <button className={styles.chip} onClick={() => setLibrary({ bpmMin: null, bpmMax: null })}>
                BPM {lib.bpmMin ?? '…'}–{lib.bpmMax ?? '…'} <span aria-hidden="true">×</span>
              </button>
            )}
            <div style={{ position: 'relative' }}>
              <button className={`${styles.chip} ${styles.chipAdd}`} onClick={() => setFilterOpen(!filterOpen)}>
                + Filter
              </button>
              {filterOpen && <BpmFilter onClose={() => setFilterOpen(false)} />}
            </div>
          </div>
          <div role="tree" aria-label="Riff packs" className={styles.tree}>
            {filtering ? <Results words={words} /> : <Tree packs={lib.packs} />}
          </div>
        </>
      ) : (
        <ProjectPatterns />
      )}

      <PreviewCard />
    </div>
  );
}

function BpmFilter({ onClose }: { onClose: () => void }) {
  const lib = useApp((s) => s.library);
  const [min, setMin] = useState(lib.bpmMin?.toString() ?? '');
  const [max, setMax] = useState(lib.bpmMax?.toString() ?? '');
  const apply = (a: string, b: string) => {
    setLibrary({ bpmMin: a ? Number(a) : null, bpmMax: b ? Number(b) : null });
    onClose();
  };
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.pop}>
        <span className="eyebrow">Tempo</span>
        <div className={styles.popRow}>
          <input className="input" type="number" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
          <span>–</span>
          <input className="input" type="number" placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
        <button
          className="btn"
          onClick={() => {
            const b = Math.round(engine.tempo.bpmAt(engine.position()));
            apply(String(b - 10), String(b + 10));
          }}
        >
          Near song tempo (±10)
        </button>
        <button className="btn btn-primary" onClick={() => apply(min, max)}>
          Apply
        </button>
      </div>
    </>
  );
}

function Tree({ packs }: { packs: Pack[] }) {
  const open = useApp((s) => s.library.open);
  const activeKey = useApp((s) => s.library.activeKey);
  const inUse = useInUse();
  const toggle = (k: string) => setLibrary({ open: { ...open, [k]: !open[k] } });
  const rows: ReactNode[] = [];
  const vis: Riff[] = [];
  for (const p of packs) {
    const pk = `p:${p.name}`;
    rows.push(<Folder key={pk} depth={0} label={p.name} meta={String(p.count)} open={!!open[pk]} onClick={() => toggle(pk)} />);
    if (!open[pk]) continue;
    for (const f of p.families) {
      const fk = `f:${p.name}/${f.name}`;
      rows.push(
        <Folder key={fk} depth={1} label={f.name} meta={f.bpm ? `${f.bpm} · ${f.riffs.length}` : String(f.riffs.length)} open={!!open[fk]} onClick={() => toggle(fk)} />,
      );
      if (!open[fk]) continue;
      for (const r of f.riffs) {
        vis.push(r);
        rows.push(<RiffRow key={r.key} riff={r} depth={2} active={r.key === activeKey} inUse={inUse.has(r.key)} />);
      }
    }
  }
  useEffect(() => {
    visible.riffs = vis;
  });
  return <>{rows}</>;
}

function Results({ words }: { words: string[] }) {
  const packs = useApp((s) => s.library.packs);
  const bpmMin = useApp((s) => s.library.bpmMin);
  const bpmMax = useApp((s) => s.library.bpmMax);
  const activeKey = useApp((s) => s.library.activeKey);
  const inUse = useInUse();
  const q = words.join(' ');
  const found = useMemo(() => {
    const ws = q.split(' ').filter(Boolean);
    const out: Riff[] = [];
    for (const p of packs) for (const f of p.families) for (const r of f.riffs) if (matches(r, ws, bpmMin, bpmMax)) out.push(r);
    return out;
  }, [packs, q, bpmMin, bpmMax]);
  const shown = found.slice(0, 400);
  useEffect(() => {
    visible.riffs = shown;
  });
  if (!found.length) return <p className={styles.empty}>No riffs match.</p>;
  let lastPack = '';
  return (
    <>
      <p className={styles.count}>
        {found.length.toLocaleString()} riff{found.length === 1 ? '' : 's'}
        {found.length > shown.length ? ` · showing ${shown.length}` : ''}
      </p>
      {shown.map((r) => {
        const header = r.pack !== lastPack ? <div className={styles.group}>{r.pack.trim()}</div> : null;
        lastPack = r.pack;
        return (
          <div key={r.key}>
            {header}
            <RiffRow riff={r} depth={1} active={r.key === activeKey} inUse={inUse.has(r.key)} showFamily />
          </div>
        );
      })}
    </>
  );
}

function useInUse() {
  const patterns = useApp((s) => s.song.patterns);
  return useMemo(() => new Set(Object.values(patterns).map((p) => (p.source ? `${p.source.pack}/${p.source.file}` : ''))), [patterns]);
}

const Folder = memo(function Folder({ depth, label, meta, open, onClick }: { depth: number; label: string; meta: string; open: boolean; onClick: () => void }) {
  return (
    <button role="treeitem" aria-expanded={open} className={styles.row} style={{ paddingLeft: 8 + depth * 14, fontWeight: depth === 0 ? 600 : 500 }} onClick={onClick}>
      <I.ChevronRight size={10} style={{ transform: `rotate(${open ? 90 : 0}deg)`, color: 'var(--muted)', flex: 'none' }} />
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.meta}>{meta}</span>
    </button>
  );
});

const RiffRow = memo(function RiffRow({ riff, depth, active, inUse, showFamily }: { riff: Riff; depth: number; active: boolean; inUse: boolean; showFamily?: boolean }) {
  return (
    <button
      role="treeitem"
      data-riff={riff.key}
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable
      onDragStart={(e) => startRiffDrag(e, riff.key)}
      onDragEnd={endDrag}
      onClick={() => {
        setLibrary({ activeKey: riff.key });
        void libraryApi.preview(riff.key);
      }}
      onDoubleClick={() => void libraryApi.insert()}
      title={`${riff.pack.trim()}/${riff.file} · click to preview · drag onto a track · Enter inserts at the playhead`}
    >
      <I.Bars style={{ color: inUse ? 'var(--accent)' : 'var(--dim)', flex: 'none' }} />
      <span className={styles.rowLabel}>{riff.name}</span>
      <span className={styles.meta} style={{ color: inUse ? 'var(--accent)' : undefined }}>
        {inUse ? 'in use' : showFamily && riff.bpm ? riff.bpm : ''}
      </span>
    </button>
  );
});

function ProjectPatterns() {
  const song = useApp((s) => s.song);
  const list = Object.values(song.patterns).map((p) => ({ p, uses: song.clips.filter((c) => c.patternId === p.id).length }));
  return (
    <div className={styles.tree}>
      {list.length === 0 && <p className={styles.empty}>No riffs in this song yet.</p>}
      {list.map(({ p, uses }) => (
        <button
          key={p.id}
          className={styles.row}
          draggable
          onDragStart={(e) => startPatternDrag(e, p.id, p.lengthTicks)}
          onDragEnd={endDrag}
          onClick={() => {
            useApp.setState({ selectedClipIds: song.clips.filter((c) => c.patternId === p.id).map((c) => c.id) });
            void engine.previewPattern(`pattern:${p.id}`, p, previewBpm());
          }}
          title="Click to preview and select its clips · drag to place a linked copy"
        >
          <I.Bars style={{ color: 'var(--accent)', flex: 'none' }} />
          <span className={styles.rowLabel}>
            {p.name}
            {p.edited ? ' •' : ''}
          </span>
          <span className={styles.meta}>
            {Math.round((p.lengthTicks / (PPQ * 4)) * 10) / 10} bar · ×{uses}
          </span>
        </button>
      ))}
    </div>
  );
}

function PreviewCard() {
  const activeKey = useApp((s) => s.library.activeKey);
  const { playing, mode, previewKey } = useTransport();
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    if (activeKey) void patternForRiff(activeKey).then((p) => live && setPattern(p)).catch(() => live && setPattern(null));
    return () => {
      live = false;
    };
  }, [activeKey]);
  useFrame(() => {
    if (lineRef.current) lineRef.current.style.left = `${engine.previewProgress() * 100}%`;
  });
  if (!activeKey || !pattern) {
    return (
      <div className={styles.card}>
        <p className={styles.hint}>Click a riff to hear it at the song's tempo. Drag it onto a track, or press Enter to drop it at the playhead.</p>
      </div>
    );
  }
  const previewing = playing && mode === 'preview' && previewKey === activeKey;
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <button
          className={styles.cardPlay}
          aria-label={previewing ? 'Stop preview' : 'Preview'}
          onClick={() => void libraryApi.preview(activeKey)}
        >
          {previewing ? <I.Stop size={10} /> : <I.Play size={10} />}
        </button>
        <div className={styles.cardText}>
          <span className={styles.cardName}>{pattern.name}</span>
          <span className={styles.cardSub}>
            {previewing ? `Previewing at song tempo · ${previewBpm()}` : `${pattern.bpm ? `${pattern.bpm} bpm · ` : ''}${Math.round(pattern.lengthTicks / (PPQ * 4))} bar`}
            {pattern.unmapped ? ` · ${pattern.unmapped.length} unmapped note${pattern.unmapped.length > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>
      <div className={styles.cardMini} aria-hidden="true">
        <PatternMini pattern={pattern} />
        {previewing && <div ref={lineRef} className={styles.cardLine} />}
      </div>
      <p className={styles.hint}>
        Drag onto a track, or press <kbd>Enter</kbd> to drop it at the playhead. <kbd>⌥Enter</kbd> replaces the selected clip.
      </p>
    </div>
  );
}
