/** Library scan: notes that riffs use but their pack's current map gives no sound, grouped where packs agree. */
import { useMemo } from 'react';
import { MAP_BY_ID } from '../../model/noteMaps';
import { noteGaps } from '../../state/mappingActions';
import type { MappingState, NoteUsage } from '../../state/mappingActions';
import { formatNotes } from './notes';
import styles from './Mapping.module.css';

interface Group {
  mapId: string;
  notes: string;
  packs: string[];
  hits: number;
  detail: string;
}

export function Coverage({ scan, mapping, onPick }: { scan: NoteUsage | null | undefined; mapping: MappingState; onPick: (mapId: string) => void }) {
  const { groups, hits, packs } = useMemo(() => {
    const gaps = scan ? noteGaps(scan, mapping) : [];
    const byKey = new Map<string, Group>();
    let total = 0;
    for (const g of gaps) {
      const notes = formatNotes(g.notes.map((n) => n.note));
      const key = `${g.mapId}|${notes}`;
      const h = g.notes.reduce((n, x) => n + x.hits, 0);
      total += h;
      const cur = byKey.get(key);
      const line = `${g.pack}: ${g.notes.map((n) => `${n.note} × ${n.hits.toLocaleString()}`).join(', ')}`;
      if (cur) {
        cur.packs.push(g.pack);
        cur.hits += h;
        cur.detail += `\n${line}`;
      } else byKey.set(key, { mapId: g.mapId, notes, packs: [g.pack], hits: h, detail: line });
    }
    return { groups: [...byKey.values()].sort((a, b) => b.hits - a.hits), hits: total, packs: gaps.length };
  }, [scan, mapping]);

  if (scan === undefined) return <span className={styles.p}>Reading the library scan…</span>;

  return (
    <>
      <div className={styles.block}>
        <span className="eyebrow">Library scan</span>
        <span className={styles.asideTitle}>Notes with no sound</span>
        {!scan ? (
          <span className={styles.p}>
            No scan yet. Run <code className={styles.code}>npm run note-usage</code> to count the notes every riff uses, then reload.
          </span>
        ) : groups.length ? (
          <span className={styles.p}>
            These notes appear {hits.toLocaleString()} times in {packs} pack{packs === 1 ? '' : 's'}, but the pack's map gives them no sound, so they're skipped
            when the riffs play. Pick a sound for them in the map, or set them to “No sound (on purpose)”.
          </span>
        ) : (
          <span className={styles.p}>Every note in the library's {scan.files.toLocaleString()} riffs has a sound, or is silent on purpose.</span>
        )}
      </div>

      {groups.length > 0 && (
        <div className={styles.gaps}>
          {groups.map((g) => {
            const mapName = MAP_BY_ID[g.mapId]?.name ?? g.mapId;
            return (
              <button key={`${g.mapId}|${g.notes}`} className={styles.gap} title={`${g.detail}\n\nShow in ${mapName}`} onClick={() => onPick(g.mapId)}>
                <span className={styles.gapTop}>
                  <span>{g.packs.length > 1 ? `${g.packs.length} packs` : g.packs[0]}</span>
                  <span className={styles.gapNotes}>{g.notes}</span>
                </span>
                <span className={styles.gapHint}>
                  {g.packs.length > 1 ? `${g.packs.join(', ')} · ` : ''}
                  {g.hits.toLocaleString()} hit{g.hits === 1 ? '' : 's'} · {mapName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {scan && (
        <span className={styles.scanNote}>
          Scanned {scan.files.toLocaleString()} riffs ({scan.hits.toLocaleString()} hits)
          {scan.generatedAt ? ` on ${new Date(scan.generatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}. After adding MIDI files, run{' '}
          <code className={styles.code}>npm run note-usage</code>.
        </span>
      )}
    </>
  );
}
