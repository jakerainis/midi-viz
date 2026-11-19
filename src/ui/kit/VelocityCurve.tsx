/** The engine's velocity curve (prefs.velCurve) over a histogram of the song's velocities. */
import { useMemo } from 'react';
import type { LoadedKit } from '../../audio/kit';
import type { Articulation } from '../../model/kit';
import { setPrefs, useApp } from '../../state/store';
import styles from './Kit.module.css';

const PRESETS = [
  { name: 'Soft', value: 0.6, hint: 'Quiet hits come up: less difference between soft and hard' },
  { name: 'Linear', value: 1, hint: 'The default' },
  { name: 'Hard', value: 1.6, hint: 'Quiet hits drop away: more difference between soft and hard' },
];

const BINS = 16;

/** Level the engine gives a hit, relative to velocity 127 (AudioEngine.trigger). */
const level = (vel: number, c: number) => Math.pow(vel / 127, 1.6 * c);

function curvePoints(c: number) {
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const vel = 1 + (126 * i) / 48;
    pts.push(`${(((vel - 1) / 126) * 100).toFixed(2)},${(100 - level(vel, c) * 100).toFixed(2)}`);
  }
  return pts.join(' ');
}

export function VelocityCurve({ kit, art }: { kit: LoadedKit | null; art: Articulation }) {
  const velCurve = useApp((s) => s.prefs.velCurve);
  const patterns = useApp((s) => s.song.patterns);

  const stats = useMemo(() => {
    const bins = new Array<number>(BINS).fill(0);
    const vels: number[] = [];
    for (const p of Object.values(patterns))
      for (const h of p.hits) {
        bins[Math.min(BINS - 1, Math.floor(((h.vel - 1) / 127) * BINS))]++;
        vels.push(h.vel);
      }
    vels.sort((a, b) => a - b);
    const q = (f: number) => vels[Math.min(vels.length - 1, Math.floor(f * vels.length))];
    return { bins, max: Math.max(1, ...bins), count: vels.length, lo: vels.length ? q(0.1) : 0, hi: vels.length ? q(0.9) : 0 };
  }, [patterns]);

  const layers = kit?.layers.get(art.id) ?? [];
  const layered = layers.length > 1;
  const preset = PRESETS.find((p) => Math.abs(p.value - velCurve) < 0.001);

  return (
    <section aria-label="Velocity curve" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.h2}>Velocity curve</h2>
        <div role="radiogroup" aria-label="Curve preset" className="seg">
          {PRESETS.map((p) => (
            <button key={p.name} role="radio" aria-checked={preset === p} title={p.hint} onClick={() => setPrefs({ velCurve: p.value })}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.plot}>
        <div aria-hidden="true" className={styles.histo}>
          {stats.bins.map((n, i) => (
            <div key={i} style={{ height: `${(n / stats.max) * 100}%` }} title={`${n} hits at velocity ${Math.ceil((i * 127) / BINS) + 1}–${Math.ceil(((i + 1) * 127) / BINS)}`} />
          ))}
        </div>
        <svg role="img" aria-label={`Velocity curve ×${velCurve.toFixed(2)}`} viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.curve}>
          <polyline points={curvePoints(1)} className={styles.curveRef} vectorEffect="non-scaling-stroke" />
          <polyline points={curvePoints(velCurve)} className={styles.curveLine} vectorEffect="non-scaling-stroke" />
        </svg>
        {layered && (
          <div aria-hidden="true" className={styles.layerTicks}>
            {layers.map((l) => (
              <span key={l.velocity} style={{ left: `${((l.velocity - 1) / 126) * 100}%` }} title={`${art.name} layer at velocity ${l.velocity}`} />
            ))}
          </div>
        )}
        <span className={styles.axisL}>velocity 1</span>
        <span className={styles.axisR}>127</span>
      </div>

      <label className={styles.slider} style={{ marginTop: 6 }}>
        <span className={styles.sliderRow}>
          <span>Curve</span>
          <span className="mono">×{velCurve.toFixed(2)}</span>
        </span>
        <input type="range" min={0.4} max={2.4} step={0.05} value={velCurve} title="Double-click for linear" onDoubleClick={() => setPrefs({ velCurve: 1 })} onChange={(e) => setPrefs({ velCurve: Number(e.target.value) })} />
      </label>

      <p className={styles.p}>
        {stats.count
          ? `The bars are this song's ${stats.count.toLocaleString()} hits; most sit between velocity ${stats.lo} and ${stats.hi}. `
          : 'The song has no hits yet, so there are no bars. '}
        The line is how loud a hit plays for its velocity; the dashed line is Linear.{' '}
        {layered
          ? `${art.name} has ${layers.length} velocity layers (the ticks) that already carry their own loudness, so the curve only shapes the steps between them.`
          : 'With one sample per drum, the curve sets the whole range from soft to hard.'}
      </p>
    </section>
  );
}
