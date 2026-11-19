/** The Inspector while notes are selected in the clip editor: velocity edits, which sample plays, moving lanes. */
import { useState } from 'react';
import { engine } from '../../audio/engine';
import { ARTICULATIONS, ART_BY_ID } from '../../model/kit';
import { formatBBT } from '../../model/timing';
import type { Clip, Pattern } from '../../model/types';
import { moveHits, noteFor, setVelocities } from '../../state/editActions';
import { setOverlay, useApp } from '../../state/store';
import { useMaps } from '../hooks';
import styles from './Selection.module.css';

type VelOp = 'set' | 'scale' | 'offset' | 'ramp' | 'rand';

export function SelectionPanel({ clip, pattern }: { clip: Clip; pattern: Pattern }) {
  const selected = useApp((s) => s.selectedHitIds);
  const kit = useApp((s) => s.kit);
  const { meter } = useMaps();
  const hits = pattern.hits.filter((h) => selected.includes(h.id)).sort((a, b) => a.tick - b.tick);
  const [op, setOp] = useState<VelOp>('ramp');
  const [a, setA] = useState(110);
  const [b, setB] = useState(80);

  if (!hits.length) {
    return (
      <div className={styles.panel}>
        <div className={styles.block}>
          <span className="eyebrow">Selection</span>
          <span className={styles.title}>Nothing selected</span>
          <span className={styles.muted}>
            {pattern.hits.length} hits in {pattern.name}. Click a hit, drag a box, or press ⌘A.
          </span>
        </div>
        <Help />
      </div>
    );
  }

  const arts = [...new Set(hits.map((h) => h.art))];
  const vMin = Math.min(...hits.map((h) => h.vel));
  const vMax = Math.max(...hits.map((h) => h.vel));
  const pos = (t: number) => formatBBT(meter.bbt(clip.start + t));
  const ids = hits.map((h) => h.id);
  const apply = () => {
    const fns: Record<VelOp, (h: { vel: number }, i: number, all: unknown[]) => number> = {
      set: () => a,
      scale: (h) => (h.vel * a) / 100,
      offset: (h) => h.vel + a,
      ramp: (_h, i, all) => (all.length < 2 ? a : a + ((b - a) * i) / (all.length - 1)),
      rand: (h) => h.vel + (Math.random() * 2 - 1) * a,
    };
    setVelocities(pattern.id, fns[op], ids);
  };
  const OPS: { id: VelOp; label: string }[] = [
    { id: 'set', label: 'Set' },
    { id: 'scale', label: 'Scale' },
    { id: 'offset', label: 'Offset' },
    { id: 'ramp', label: 'Ramp' },
    { id: 'rand', label: 'Rand' },
  ];
  const fieldA = { set: 'Velocity', scale: 'Percent', offset: 'Amount', ramp: 'From', rand: '± amount' }[op];

  // Which kit layer each selected hit lands on (first articulation).
  const art = arts[0];
  const layers = kit.status === 'ready' ? engine.kit?.layers.get(art) : undefined;
  const nearest = (v: number) => layers?.reduce((best, l, i) => (Math.abs(l.velocity - v) < Math.abs(layers[best].velocity - v) ? i : best), 0) ?? -1;
  const usedLayers = new Set(hits.filter((h) => h.art === art).map((h) => nearest(h.vel)));
  const sampleName = engine.kit?.manifest?.pieces?.find((p) => p.id === ART_BY_ID[art]?.piece)?.sampleName;

  return (
    <div className={styles.panel}>
      <div className={styles.block}>
        <span className="eyebrow">Selection</span>
        <span className={styles.title}>
          {hits.length} hit{hits.length > 1 ? 's' : ''} · {arts.length === 1 ? ART_BY_ID[art]?.name : `${arts.length} lanes`}
        </span>
        <span className={`mono ${styles.muted}`}>
          {pos(hits[0].tick)}
          {hits.length > 1 ? ` – ${pos(hits[hits.length - 1].tick)}` : ''} · vel {vMin === vMax ? vMin : `${vMin}–${vMax}`}
        </span>
      </div>

      <div className={styles.block}>
        <span className="eyebrow">Velocity</span>
        <div role="radiogroup" aria-label="Velocity operation" className={`seg ${styles.ops}`}>
          {OPS.map((o) => (
            <button key={o.id} role="radio" aria-checked={op === o.id} onClick={() => setOp(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className={styles.fields}>
          <label>
            {fieldA}
            <input className="input" type="number" value={a} onChange={(e) => setA(Number(e.target.value))} />
          </label>
          {op === 'ramp' && (
            <label>
              To
              <input className="input" type="number" min={1} max={127} value={b} onChange={(e) => setB(Number(e.target.value))} />
            </label>
          )}
        </div>
        <button className="btn btn-primary" onClick={apply}>
          Apply to {hits.length} hit{hits.length > 1 ? 's' : ''}
        </button>
        <span className={styles.muted}>
          <kbd>[</kbd> <kbd>]</kbd> nudge by 8 · with ⇧ by 1
        </span>
      </div>

      {layers && layers.length > 0 && (
        <div className={styles.block}>
          <span className="eyebrow">Which sample plays</span>
          <div className={styles.layers} aria-hidden="true">
            {layers.map((l, i) => (
              <div key={i} className={styles.layer} style={{ flex: 1, opacity: usedLayers.has(i) ? 1 : 0.35, background: usedLayers.has(i) ? 'var(--accent)' : 'var(--pressed)' }} title={`Layer ${i + 1} · velocity ${l.velocity} · ${l.buffers.length} round-robin${l.buffers.length > 1 ? 's' : ''}`} />
            ))}
          </div>
          <div className={styles.layerScale}>
            <span>vel 1</span>
            <span>127</span>
          </div>
          <span className={styles.muted}>
            {sampleName ? `${sampleName}. ` : ''}
            {usedLayers.size === 1 ? `These hits use velocity layer ${[...usedLayers][0] + 1} of ${layers.length}` : `These hits span ${usedLayers.size} of ${layers.length} velocity layers`}
            {layers[0].buffers.length > 1 ? `, and repeated hits rotate through ${layers[0].buffers.length} round-robins.` : '.'}
          </span>
        </div>
      )}

      <div className={styles.block}>
        <span className="eyebrow">Move</span>
        <label className={styles.fieldCol}>
          Move hits to lane
          <select
            className="select"
            value={arts.length === 1 ? art : ''}
            onChange={(e) => {
              const to = e.target.value;
              moveHits(pattern.id, hits.map((h) => ({ id: h.id, tick: h.tick, art: to, note: noteFor(pattern, to) })));
              void engine.audition(to, hits[0].vel);
            }}
          >
            {arts.length > 1 && <option value="">Mixed</option>}
            {ARTICULATIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.muted}>⌥↑ ⌥↓ moves the selection one lane · ← → by grid</span>
      </div>

      <div className={styles.actions}>
        <button className="btn" onClick={() => setOverlay('export')}>
          Export this riff
        </button>
      </div>
    </div>
  );
}

function Help() {
  return (
    <div className={styles.block}>
      <span className="eyebrow">Tools</span>
      <ul className={styles.help}>
        <li>
          <b>Select (V)</b>: click or box-select hits; drag to move (⌥ for off-grid).
        </li>
        <li>
          <b>Draw (B)</b>: click or drag to add hits on the grid; click a hit to remove it.
        </li>
        <li>
          <b>Erase (E)</b>: click or drag over hits.
        </li>
        <li>
          <b>Line (L)</b>: drag across the velocity lane to ramp.
        </li>
        <li>Click a lane name to hear it and show only its velocities.</li>
        <li>Click or drag the ruler to move the playhead, then Space plays from there. ← → move it by a bar.</li>
      </ul>
    </div>
  );
}

