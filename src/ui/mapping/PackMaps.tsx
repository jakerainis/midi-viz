/** Which note map each riff pack uses. */
import { useMemo } from 'react';
import { NOTE_MAPS, defaultMapForPack } from '../../model/noteMaps';
import { noteGaps, packMapId, setPackMap } from '../../state/mappingActions';
import type { MappingState, NoteUsage } from '../../state/mappingActions';
import { formatNotes } from './notes';
import type { PackInfo } from './MappingView';
import styles from './Mapping.module.css';

export function PackMaps({
  packs,
  mapping,
  scan,
  selectedMapId,
  onPickMap,
}: {
  packs: PackInfo[];
  mapping: MappingState;
  scan: NoteUsage | null | undefined;
  selectedMapId: string;
  onPickMap: (id: string) => void;
}) {
  const gaps = useMemo(() => new Map((scan ? noteGaps(scan, mapping) : []).map((g) => [g.pack, g])), [scan, mapping]);

  return (
    <section aria-label="Pack maps" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>Packs</h2>
        <span className={styles.sectionNote}>Riffs added from a pack use its map straight away. Clips already in the song need a re-map.</span>
      </div>
      <div role="table" aria-label="Map per pack" className={styles.table}>
        <div role="row" className={`${styles.packRow} ${styles.headRow}`}>
          <span role="columnheader">Pack</span>
          <span role="columnheader">Riffs</span>
          <span role="columnheader">Map</span>
          <span role="columnheader">No sound</span>
        </div>
        {packs.map((p) => {
          const id = packMapId(mapping, p.name);
          const def = defaultMapForPack(p.name);
          const gap = gaps.get(p.name);
          return (
            <div role="row" key={p.name} className={styles.packRow} data-current={id === selectedMapId || undefined}>
              <span role="cell" className={styles.packName} title={p.name}>
                {p.name}
              </span>
              <span role="cell" className={styles.packRiffs}>
                {p.riffs.toLocaleString()}
              </span>
              <span role="cell">
                <label className={styles.playsLabel}>
                  <span className="sr-only">Map for {p.name}</span>
                  <select className={`select ${styles.plays}`} value={id} onChange={(e) => setPackMap(p.name, e.target.value)}>
                    {NOTE_MAPS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.id === def ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </span>
              <span role="cell" className={styles.packGap}>
                {gap ? (
                  <button
                    className={styles.gapLink}
                    title={gap.notes.map((n) => `Note ${n.note}: ${n.hits.toLocaleString()} hits in ${n.files.toLocaleString()} riffs`).join('\n')}
                    onClick={() => onPickMap(id)}
                  >
                    {formatNotes(gap.notes.map((n) => n.note))}
                  </button>
                ) : (
                  <span className={styles.dim}>{scan ? '—' : '?'}</span>
                )}
              </span>
            </div>
          );
        })}
        {!packs.length && <div className={styles.emptyRow}>The riff library hasn't loaded.</div>}
      </div>
    </section>
  );
}
