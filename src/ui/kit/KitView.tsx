/**
 * Kit & samples: pick a kit (built in, or one of yours stored in this browser), browse its pieces and samples,
 * shape velocity response and level.
 */
import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { selectKit } from '../../audio/bridge';
import type { LoadedKit } from '../../audio/kit';
import { PIECES } from '../../model/kit';
import type { Articulation } from '../../model/kit';
import { setPrefs, useApp } from '../../state/store';
import * as I from '../icons';
import { artLabel, artsOf, borrowedFrom, formatDb, formatDuration, hasSound, noteOf, sampleCount, sampleNameOf, shapeOf } from './kitInfo';
import { LayerGrid } from './LayerGrid';
import { ChokeGroups, SourcePanel } from './SourcePanel';
import { VelocityCurve } from './VelocityCurve';
import styles from './Kit.module.css';

export function KitView() {
  const kit = useApp((s) => s.kit);
  const [pieceId, setPieceId] = useState('snare');
  const [artFor, setArtFor] = useState<Record<string, string>>({});
  // The engine's kit is what plays. The store's kit state changes whenever it does (rev), which re-renders this
  // view; while another kit loads, the old one keeps playing.
  const loaded: LoadedKit | null = engine.kit;
  const pending = kit.status === 'loading' && kit.id !== loaded?.id ? kit.name : null;
  const arts = artsOf(pieceId);
  const art = arts.find((a) => a.id === artFor[pieceId]) ?? arts[0];
  const sweep = useSweep();

  const pickPiece = (id: string) => {
    sweep.stop();
    setPieceId(id);
  };
  const pickArt = (id: string) => {
    sweep.stop();
    setArtFor({ ...artFor, [pieceId]: id });
  };

  return (
    <div className={styles.view}>
      <aside aria-label="Kit pieces" className={styles.left}>
        <KitPicker />
        <div className={styles.pieces}>
          {PIECES.map((p) => {
            const pa = artsOf(p.id);
            const silent = !!loaded && !pa.some((a) => hasSound(loaded, a.id));
            const label = silent ? 'No sample' : (sampleNameOf(loaded, p.id) ?? shapeOf(loaded, pa[0].id) ?? '—');
            return (
              <button key={p.id} className={styles.piece} aria-pressed={p.id === pieceId} onClick={() => pickPiece(p.id)}>
                <span className={styles.pieceName}>{p.name}</span>
                <span className={styles.pieceSample} data-silent={silent || undefined}>
                  {label}
                </span>
                <span className={styles.pieceNote} title={pa.map((a) => `${a.name}: note ${noteOf(loaded, a)}`).join('\n')}>
                  {noteOf(loaded, pa[0])}
                  {pa.length > 1 ? '+' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className={styles.body}>
        <main className={styles.main}>
          <PieceHeader pieceId={pieceId} art={art} kit={loaded} pending={pending} sweep={sweep} />

          {arts.length > 1 && (
            <section aria-label="Articulations" className={styles.section}>
              <h2 className={styles.h2}>Articulations</h2>
              <div className={styles.chips}>
                {arts.map((a) => (
                  <button key={a.id} className={styles.chip} aria-pressed={a.id === art.id} onClick={() => pickArt(a.id)} data-silent={(!!loaded && !hasSound(loaded, a.id)) || undefined}>
                    {artLabel(a)}
                    <span>{noteOf(loaded, a)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <Borrowed kit={loaded} art={art} />

          <div className={styles.cards}>
            <LayerGrid key={`${loaded?.id}:${art.id}:${kit.rev}`} kit={loaded} art={art} sweepVel={sweep.state?.art === art.id ? sweep.state.vel : null} />
            <VelocityCurve kit={loaded} art={art} />
          </div>

          <MixCard kit={loaded} />
        </main>

        <aside aria-label="Kit details" className={styles.right}>
          <SourcePanel kit={loaded} art={art} />
          <ChokeGroups />
        </aside>
      </div>

    </div>
  );
}

function KitPicker() {
  const kit = useApp((s) => s.kit);
  const loading = kit.status === 'loading';
  const known = kit.available.some((k) => k.id === kit.id);
  const pct = Math.round(kit.progress * 100);
  const loaded = engine.kit;

  return (
    <div className={styles.picker}>
      <label className={styles.pickerLabel}>
        <span className="eyebrow">Kit</span>
        {kit.available.length > 1 ? (
          <select className={`select ${styles.kitSelect}`} value={kit.id} onChange={(e) => void selectKit(e.target.value)}>
            {!known && <option value={kit.id}>{kit.name}</option>}
            {kit.available.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.kitName}>{kit.name}</span>
        )}
      </label>
      <div className={styles.pickerRow}>
        {loading ? (
          <div className={styles.progress} role="progressbar" aria-label={`Loading ${kit.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={styles.progressBar}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="mono">{pct}%</span>
          </div>
        ) : kit.status === 'error' ? (
          <span className={styles.err}>
            <I.Warn /> No kit loaded
          </span>
        ) : loaded ? (
          <span className={styles.pickerNote}>
            {sampleCount(loaded).toLocaleString()} samples · {formatDuration(loaded.seconds)}
          </span>
        ) : null}
      </div>
      {loading && kit.playable && loaded?.id === kit.id && <span className={styles.pickerHint}>Kick, snare and hi-hat are in, so you can already play. The rest is on its way.</span>}
      {loading && loaded && loaded.id !== kit.id && <span className={styles.pickerHint}>{loaded.name} keeps playing until it's done.</span>}
      {kit.error && (
        <span className={styles.errBlock} role="alert">
          <I.Warn /> {kit.error}
        </span>
      )}
      {!loading && kit.failed > 0 && (
        <span className={styles.warnBlock}>
          <I.Warn /> {kit.failed} sample{kit.failed > 1 ? 's' : ''} couldn't be decoded by this browser and {kit.failed > 1 ? 'are' : 'is'} left out.
        </span>
      )}
    </div>
  );
}

function Borrowed({ kit, art }: { kit: LoadedKit | null; art: Articulation }) {
  const from = borrowedFrom(kit, art.id);
  if (!from || !kit) return null;
  return (
    <p className={styles.note}>
      This kit has no samples of its own for {art.name}, so it plays the {from.name} samples.
    </p>
  );
}

function PieceHeader({ pieceId, art, kit, pending, sweep }: { pieceId: string; art: Articulation; kit: LoadedKit | null; pending: string | null; sweep: Sweep }) {
  const piece = PIECES.find((p) => p.id === pieceId)!;
  const sample = sampleNameOf(kit, pieceId);
  const arts = artsOf(pieceId);
  const notes = arts.map((a) => noteOf(kit, a));
  const sweeping = sweep.state?.art === art.id;
  const playable = hasSound(kit, art.id);
  return (
    <div className={styles.header}>
      <div className={styles.titleBlock}>
        <span className="eyebrow">
          {piece.name} · note{notes.length > 1 ? 's' : ''} {notes.join(' ')}
        </span>
        <h1 className={styles.h1}>{sample ?? piece.name}</h1>
        <span className={styles.kitLine}>
          {kit ? `${piece.name} in ${kit.name}` : 'No kit loaded yet'}
          {pending ? ` · loading ${pending}…` : ''}
        </span>
      </div>
      <div style={{ flex: 1 }} />
      {sweeping && (
        <span className={styles.sweepVel} aria-live="polite">
          velocity {sweep.state!.vel}
        </span>
      )}
      <button
        className={`btn btn-primary ${styles.sweepBtn}`}
        disabled={!playable}
        onClick={() => (sweeping ? sweep.stop() : sweep.start(art))}
        title={`Plays ${art.name} at 16 velocities from soft to hard`}
      >
        {sweeping ? <I.Stop size={12} /> : <I.Play size={12} />}
        {sweeping ? 'Stop sweep' : 'Audition sweep 1 → 127'}
      </button>
    </div>
  );
}

interface Sweep {
  state: { art: string; vel: number } | null;
  start: (art: Articulation) => void;
  stop: () => void;
}

/** Plays an articulation at rising velocities through the normal engine path (layer pick, curve, round-robin). */
function useSweep(): Sweep {
  const [state, setState] = useState<Sweep['state']>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);
  const stop = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current.length = 0;
    setState(null);
  };
  const start = (art: Articulation) => {
    stop();
    const steps = 16;
    // Let cymbals ring a little before the next hit.
    const gap = art.group === 'cymbals' ? 600 : art.group === 'hihat' ? 260 : 320;
    for (let i = 0; i < steps; i++) {
      const vel = Math.round(1 + (126 * i) / (steps - 1));
      timers.current.push(
        window.setTimeout(() => {
          void engine.audition(art.id, vel);
          setState({ art: art.id, vel });
        }, i * gap),
      );
    }
    timers.current.push(window.setTimeout(() => setState(null), steps * gap + 200));
  };
  return { state, start, stop };
}

function MixCard({ kit }: { kit: LoadedKit | null }) {
  const masterDb = useApp((s) => s.prefs.masterDb);
  return (
    <section aria-label="Output" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.h2}>Output</h2>
        <span className={styles.cardNote}>One kit plays every track and the library previews</span>
      </div>
      <div className={styles.mixRow}>
        <label className={styles.slider}>
          <span className={styles.sliderRow}>
            <span>Master volume</span>
            <span className="mono">{formatDb(masterDb)}</span>
          </span>
          <input
            type="range"
            min={-30}
            max={6}
            step={0.5}
            value={masterDb}
            title="Double-click for 0 dB"
            onDoubleClick={() => setPrefs({ masterDb: 0 })}
            onChange={(e) => setPrefs({ masterDb: Number(e.target.value) })}
          />
        </label>
        <div className={styles.micNote}>
          <span className={styles.micTitle}>Mic mix</span>
          <span>
            {kit?.builtin
              ? 'Each sample is a finished stereo mix of the close mics, overheads and room, so there are no separate mics to balance here.'
              : 'Each sample plays as it was made: whatever mic blend is in the files is the mix. Balancing mics here would need separate files per mic.'}
          </span>
        </div>
      </div>
    </section>
  );
}
