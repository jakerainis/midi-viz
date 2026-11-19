/** Tempo controls from the LCD: the song's tempo, a change at the playhead, and the list of changes. */
import { useState } from 'react';
import { engine } from '../audio/engine';
import { edit, useApp } from '../state/store';
import { removeTempoPoint, setTempoAt } from '../state/songActions';
import { useMaps } from './hooks';
import * as I from './icons';
import styles from './TopBar.module.css';

const clampBpm = (v: number) => Math.max(20, Math.min(400, Math.round(v * 10) / 10));
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function TempoPopover({ onClose }: { onClose: () => void }) {
  const pts = useApp((s) => s.song.tempo);
  const { tempo, meter } = useMaps();
  // The bar the playhead is in when the popover opens.
  const [at] = useState(() => meter.snapBar(engine.position(), 'floor'));
  const bar = meter.bbt(at).bar;
  const [songBpm, setSongBpm] = useState(fmt(pts[0].bpm));
  const [hereBpm, setHereBpm] = useState(fmt(tempo.bpmAt(at)));
  const changeHere = pts.find((p) => p.tick === at && p.tick > 0);

  const applySong = () => {
    const v = Number(songBpm);
    if (v > 0) setTempoAt(0, clampBpm(v));
  };
  const applyHere = () => {
    const v = Number(hereBpm);
    if (v > 0) setTempoAt(at, clampBpm(v));
  };

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div role="dialog" aria-label="Tempo" className={`${styles.menu} ${styles.tempoPop}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <label className={styles.tempoRow}>
          <span>
            <b>Song tempo</b>
            <span className={styles.tempoSub}>{pts.length > 1 ? `Until the first change at bar ${meter.bbt(pts[1].tick).bar}` : 'The whole song'}</span>
          </span>
          <input
            className="input mono"
            type="number"
            step="0.1"
            min={20}
            max={400}
            value={songBpm}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setSongBpm(e.target.value)}
            onBlur={applySong}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySong();
              e.stopPropagation();
            }}
          />
        </label>
        {pts.length > 1 && (
          <button
            className="btn"
            onClick={() => {
              const v = clampBpm(Number(songBpm) || pts[0].bpm);
              edit((s) => {
                s.tempo = [{ tick: 0, bpm: v }];
              });
            }}
          >
            Use {fmt(clampBpm(Number(songBpm) || pts[0].bpm))} for the whole song
          </button>
        )}
        <hr />
        <label className={styles.tempoRow}>
          <span>
            <b>From bar {bar}</b>
            <span className={styles.tempoSub}>{changeHere ? 'Changes the tempo change here' : at === 0 ? 'Same as the song tempo' : 'Adds a tempo change at the playhead'}</span>
          </span>
          <input
            className="input mono"
            type="number"
            step="0.1"
            min={20}
            max={400}
            value={hereBpm}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setHereBpm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyHere();
              e.stopPropagation();
            }}
          />
        </label>
        <div className={styles.tempoActions}>
          <button className="btn btn-primary" onClick={applyHere}>
            {changeHere || at === 0 ? 'Set' : `Change tempo at bar ${bar}`}
          </button>
          {changeHere && (
            <button className="btn" onClick={() => removeTempoPoint(at)}>
              Remove change
            </button>
          )}
        </div>
        {pts.length > 1 && (
          <>
            <hr />
            <span className="eyebrow" style={{ padding: '2px 4px' }}>
              Tempo changes
            </span>
            {pts.slice(1).map((p) => (
              <div key={p.tick} className={styles.tempoItem}>
                <button className={styles.tempoGo} onClick={() => engine.seek(p.tick)} title="Move the playhead here">
                  Bar {meter.bbt(p.tick).bar}
                </button>
                <span className="mono">{fmt(p.bpm)} bpm</span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label={`Remove the change at bar ${meter.bbt(p.tick).bar}`} onClick={() => removeTempoPoint(p.tick)}>
                  <I.Close size={11} />
                </button>
              </div>
            ))}
          </>
        )}
        <p className={styles.tempoHint}>You can also drag the steps in the tempo lane, or double-click the lane to add a change.</p>
      </div>
    </>
  );
}
