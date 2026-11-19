/** Velocity layer × round-robin grid for one articulation. Each cell plays exactly that sample. */
import { Fragment, useState } from 'react';
import { engine } from '../../audio/engine';
import type { LoadedKit } from '../../audio/kit';
import type { Articulation } from '../../model/kit';
import { nearestLayer } from './kitInfo';
import styles from './Kit.module.css';

/** Accent strength per layer: soft layers sit close to the panel colour, the hardest is full accent. */
const mix = (i: number, n: number) => (n < 2 ? 100 : Math.round(22 + (78 * i) / (n - 1)));

export function LayerGrid({ kit, art, sweepVel }: { kit: LoadedKit | null; art: Articulation; sweepVel: number | null }) {
  const [last, setLast] = useState<{ layer: number; rr: number } | null>(null);
  const layers = kit?.layers.get(art.id) ?? [];
  const rrMax = layers.reduce((m, l) => Math.max(m, l.buffers.length), 0);
  const sweepLayer = sweepVel !== null && layers.length ? nearestLayer(layers, sweepVel) : -1;
  const lastBuf = last ? layers[last.layer]?.buffers[last.rr] : undefined;
  const uneven = layers.some((l) => l.buffers.length !== rrMax);

  return (
    <section aria-label="Velocity layers" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.h2}>Velocity layers × round-robin</h2>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {layers.length} × {uneven ? `≤${rrMax}` : rrMax}
        </span>
      </div>

      {!layers.length || !rrMax ? (
        <p className={styles.p}>{kit ? `${art.name} has no samples in this kit.` : 'No kit loaded yet.'}</p>
      ) : (
        <div className={styles.layerGrid} style={{ gridTemplateColumns: `36px repeat(${layers.length}, minmax(0, 1fr))` }}>
          <span className={styles.gridCorner}>vel</span>
          {layers.map((l, i) => (
            <span key={i} className={styles.gridHead} data-active={i === sweepLayer || undefined} title={`Layer ${i + 1}, for velocity ${l.velocity}`}>
              {l.velocity}
            </span>
          ))}
          {Array.from({ length: rrMax }, (_, rr) => (
            <Fragment key={rr}>
              <span className={styles.gridRow}>RR{rr + 1}</span>
              {layers.map((l, li) => {
                const buf = l.buffers[rr];
                if (!buf) return <span key={li} className={styles.cellEmpty} title="No sample for this round-robin" />;
                const isLast = last?.layer === li && last.rr === rr;
                return (
                  <button
                    key={li}
                    className={styles.cell}
                    data-last={isLast || undefined}
                    data-active={li === sweepLayer || undefined}
                    style={{ background: `color-mix(in srgb, var(--accent) ${mix(li, layers.length)}%, var(--raised))` }}
                    aria-label={`Play velocity ${l.velocity}, round-robin ${rr + 1}`}
                    title={`Velocity ${l.velocity} · round-robin ${rr + 1} · ${buf.duration.toFixed(2)} s`}
                    onClick={() => {
                      setLast({ layer: li, rr });
                      void engine.auditionSample(art.id, li, rr);
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      <p className={styles.p}>
        {last && lastBuf ? (
          <>
            Played <strong>velocity {layers[last.layer].velocity}, round-robin {last.rr + 1}</strong> ({lastBuf.duration.toFixed(2)} s) at its own
            level.{' '}
          </>
        ) : (
          'Click a cell to hear that exact sample. '
        )}
        {layers.length > 1
          ? 'In a song each hit plays the layer nearest its velocity, and a random round-robin that is never the same one twice in a row.'
          : 'This kit has one sample here, so every hit plays it and only the volume follows velocity.'}
      </p>
    </section>
  );
}
