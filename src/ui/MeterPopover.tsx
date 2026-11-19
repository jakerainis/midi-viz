/** Time-signature controls from the LCD: the song's, a change at the playhead, and the list of changes. */
import { useState } from 'react';
import { engine } from '../audio/engine';
import { edit, useApp } from '../state/store';
import { removeMeterPoint, setMeterAt } from '../state/songActions';
import { useMaps } from './hooks';
import * as I from './icons';
import styles from './TopBar.module.css';

const DENOMS = [2, 4, 8, 16];

function SigInput({ num, den, onChange }: { num: number; den: number; onChange: (num: number, den: number) => void }) {
  return (
    <span className={styles.sigInput}>
      <input
        className="input mono"
        type="number"
        min={1}
        max={32}
        aria-label="Beats per bar"
        value={num}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(Number(e.target.value), den)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <span>/</span>
      <select className="select mono" aria-label="Beat value" value={den} onChange={(e) => onChange(num, Number(e.target.value))}>
        {DENOMS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </span>
  );
}

export function MeterPopover({ onClose }: { onClose: () => void }) {
  const pts = useApp((s) => s.song.meter);
  const { meter } = useMaps();
  const [at] = useState(() => meter.snapBar(engine.position(), 'floor'));
  const bar = meter.bbt(at).bar;
  const cur = meter.meterAt(at);
  const [song, setSong] = useState({ num: pts[0].num, den: pts[0].den });
  const [here, setHere] = useState({ num: cur.num, den: cur.den });
  const changeHere = pts.find((p) => p.tick === at && p.tick > 0);
  const valid = (v: { num: number; den: number }) => v.num >= 1 && v.num <= 32;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div role="dialog" aria-label="Time signature" className={`${styles.menu} ${styles.tempoPop} ${styles.popRight}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className={styles.tempoRow}>
          <span>
            <b>Song time signature</b>
            <span className={styles.tempoSub}>{pts.length > 1 ? `Until the first change at bar ${meter.bbt(pts[1].tick).bar}` : 'The whole song'}</span>
          </span>
          <SigInput num={song.num} den={song.den} onChange={(num, den) => setSong({ num, den })} />
        </div>
        <div className={styles.tempoActions}>
          <button className="btn btn-primary" disabled={!valid(song)} onClick={() => setMeterAt(0, song.num, song.den)}>
            Set
          </button>
          {pts.length > 1 && (
            <button
              className="btn"
              disabled={!valid(song)}
              onClick={() =>
                edit((s) => {
                  s.meter = [{ tick: 0, num: song.num, den: song.den }];
                })
              }
            >
              Whole song
            </button>
          )}
        </div>
        <hr />
        <div className={styles.tempoRow}>
          <span>
            <b>From bar {bar}</b>
            <span className={styles.tempoSub}>{changeHere ? 'Changes the change here' : at === 0 ? 'Same as the song' : 'Adds a change at the playhead'}</span>
          </span>
          <SigInput num={here.num} den={here.den} onChange={(num, den) => setHere({ num, den })} />
        </div>
        <div className={styles.tempoActions}>
          <button className="btn btn-primary" disabled={!valid(here)} onClick={() => setMeterAt(at, here.num, here.den)}>
            {changeHere || at === 0 ? 'Set' : `Change at bar ${bar}`}
          </button>
          {changeHere && (
            <button className="btn" onClick={() => removeMeterPoint(at)}>
              Remove change
            </button>
          )}
        </div>
        {pts.length > 1 && (
          <>
            <hr />
            <span className="eyebrow" style={{ padding: '2px 4px' }}>
              Time-signature changes
            </span>
            {pts.slice(1).map((p) => (
              <div key={p.tick} className={styles.tempoItem}>
                <button className={styles.tempoGo} onClick={() => engine.seek(p.tick)} title="Move the playhead here">
                  Bar {meter.bbt(p.tick).bar}
                </button>
                <span className="mono">
                  {p.num}/{p.den}
                </span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label={`Remove the change at bar ${meter.bbt(p.tick).bar}`} onClick={() => removeMeterPoint(p.tick)}>
                  <I.Close size={11} />
                </button>
              </div>
            ))}
          </>
        )}
        <p className={styles.tempoHint}>Notes stay where they are; only the bars around them change. A clip whose riff is in another time signature can also switch the song to it from the panel on the right.</p>
      </div>
    </>
  );
}
