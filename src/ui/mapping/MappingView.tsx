/** MIDI mapping: which note plays which drum, per note map, and which map each riff pack uses. */
import { useEffect, useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import { ARTICULATIONS, ART_BY_ID, GROUP_LABEL } from '../../model/kit';
import type { LaneGroup } from '../../model/kit';
import { MAP_BY_ID, NOTE_MAPS } from '../../model/noteMaps';
import type { NoteMap, NoteMapEntry } from '../../model/noteMaps';
import { loadNoteUsage, packMapId, resetOverrides, selectMap, setNoteOverride } from '../../state/mappingActions';
import type { MappingState, NoteCount, NoteUsage } from '../../state/mappingActions';
import { useApp } from '../../state/store';
import * as I from '../icons';
import { Coverage } from './Coverage';
import { PackMaps } from './PackMaps';
import { RemapBanner } from './RemapBanner';
import styles from './Mapping.module.css';

export type Filter = 'all' | 'used' | 'flagged';

export interface PackInfo {
  name: string;
  riffs: number;
}

/** undefined while loading, null when public/midi/note-usage.json hasn't been generated. */
function useNoteUsage() {
  const [scan, setScan] = useState<NoteUsage | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadNoteUsage().then((d) => {
      if (live) setScan(d);
    });
    return () => {
      live = false;
    };
  }, []);
  return scan;
}

export function MappingView() {
  const mapping = useApp((s) => s.mapping);
  const libPacks = useApp((s) => s.library.packs);
  const scan = useNoteUsage();
  const [filter, setFilter] = useState<Filter>('all');
  const map = MAP_BY_ID[mapping.selectedMapId] ?? NOTE_MAPS[0];

  // Packs from the library, or from the scan until the library has loaded.
  const packs: PackInfo[] = useMemo(
    () =>
      libPacks.length
        ? libPacks.map((p) => ({ name: p.name, riffs: p.count }))
        : Object.entries(scan?.packs ?? {}).map(([name, v]) => ({ name, riffs: v.files })),
    [libPacks, scan],
  );

  const pick = (id: string) => {
    selectMap(id);
    setFilter('all');
  };

  return (
    <div className={styles.view}>
      <aside aria-label="Note maps" className={styles.left}>
        <h2 className={styles.h2}>Note maps</h2>
        <div className={styles.maps}>
          {NOTE_MAPS.map((m) => {
            const using = packs.filter((p) => packMapId(mapping, p.name) === m.id);
            const riffs = using.reduce((n, p) => n + p.riffs, 0);
            const ov = Object.keys(mapping.overrides[m.id] ?? {}).length;
            return (
              <button key={m.id} className={styles.mapBtn} aria-pressed={m.id === map.id} onClick={() => pick(m.id)}>
                <span className={styles.mapName}>
                  {m.name}
                  {m.needsReview && <span className={styles.review}>needs review</span>}
                </span>
                <span className={styles.mapSub}>
                  {using.length ? `${using.length} pack${using.length > 1 ? 's' : ''} · ${riffs.toLocaleString()} riffs` : m.description}
                  {ov ? ` · ${ov} override${ov > 1 ? 's' : ''}` : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.how}>
          <span className={styles.howTitle}>How a riff picks its map</span>
          <ol>
            <li>The map chosen for its pack (Packs, below the table)</li>
            <li>Otherwise the pack's default: packs that use note 24 get Ugritone classic, Progressive Death Metal gets Prog Death, the rest get Ugritone packs</li>
            <li>Files you import get whichever map leaves the fewest notes with no sound</li>
          </ol>
          <span className={styles.howNote}>Changes to a map apply to every pack that uses it.</span>
        </div>
      </aside>

      <div className={styles.body}>
        <main className={styles.main}>
          <MapTable map={map} mapping={mapping} packs={packs} scan={scan} filter={filter} setFilter={setFilter} />
          <PackMaps packs={packs} mapping={mapping} scan={scan} selectedMapId={map.id} onPickMap={pick} />
        </main>
        <aside aria-label="Library coverage" className={styles.right}>
          <Coverage
            scan={scan}
            mapping={mapping}
            onPick={(mapId) => {
              selectMap(mapId);
              setFilter('flagged');
            }}
          />
        </aside>
      </div>
    </div>
  );
}

type Status = 'ok' | 'fixed' | 'fallback' | 'override' | 'missing';

const STATUS_LABEL: Record<Status, string> = { ok: 'OK', fixed: 'Fixed', fallback: 'Fallback', override: 'Override', missing: 'No sound' };

interface Row {
  note: number;
  src?: string;
  entry?: NoteMapEntry;
  /** undefined = no override, null = silent on purpose. */
  override?: string | null;
  art?: string;
  used?: NoteCount;
  status: Status;
  why: string;
}

const SILENT = '__silent';

const GROUP_ORDER: LaneGroup[] = ['kick', 'snare', 'toms', 'hihat', 'cymbals'];
const ART_GROUPS = GROUP_ORDER.map((g) => ({ group: g, arts: ARTICULATIONS.filter((a) => a.group === g) }));

function MapTable({
  map,
  mapping,
  packs,
  scan,
  filter,
  setFilter,
}: {
  map: NoteMap;
  mapping: MappingState;
  packs: PackInfo[];
  scan: NoteUsage | null | undefined;
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  const ov = mapping.overrides[map.id];
  const using = useMemo(() => packs.filter((p) => packMapId(mapping, p.name) === map.id), [packs, mapping, map.id]);
  const riffs = using.reduce((n, p) => n + p.riffs, 0);

  // Note → hits and files across the packs that use this map.
  const usage = useMemo(() => {
    const out = new Map<number, NoteCount>();
    for (const p of using) {
      const notes = scan?.packs[p.name]?.notes;
      if (!notes) continue;
      for (const [n, c] of Object.entries(notes)) {
        const cur = out.get(Number(n)) ?? { hits: 0, files: 0 };
        out.set(Number(n), { hits: cur.hits + c.hits, files: cur.files + c.files });
      }
    }
    return out;
  }, [scan, using]);

  const rows: Row[] = useMemo(() => {
    const notes = new Set<number>([...Object.keys(map.notes).map(Number), ...Object.keys(ov ?? {}).map(Number), ...usage.keys()]);
    return [...notes]
      .sort((a, b) => a - b)
      .map((note) => {
        const entry = map.notes[note];
        const override = ov && note in ov ? ov[note] : undefined;
        const art = override !== undefined ? (override ?? undefined) : entry?.art;
        const base = { note, src: map.sourceNames?.[note], entry, override, art, used: usage.get(note) };
        if (override !== undefined) {
          const was = entry ? (ART_BY_ID[entry.art]?.name ?? entry.art) : 'nothing';
          return { ...base, status: 'override' as const, why: override === null ? `Silent on purpose · map plays ${was}` : `Map plays ${was}` };
        }
        if (entry) return { ...base, status: (entry.status ?? 'ok') as Status, why: entry.note ?? '' };
        return { ...base, status: 'missing' as const, why: 'Not in this map, so riffs skip it' };
      });
  }, [map, ov, usage]);

  const usedCount = rows.filter((r) => r.used?.hits).length;
  const flaggedCount = rows.filter((r) => r.status !== 'ok').length;
  const shown = rows.filter((r) => (filter === 'used' ? !!r.used?.hits : filter === 'flagged' ? r.status !== 'ok' : true));
  const ovCount = Object.keys(ov ?? {}).length;
  // Only some maps know the names the pack's documentation gives each note.
  const hasNames = !!map.sourceNames;

  return (
    <>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className="eyebrow">
            Note map · {using.length ? `${using.length} pack${using.length > 1 ? 's' : ''} · ${riffs.toLocaleString()} riffs` : 'no pack uses it'}
          </span>
          <h1 className={styles.h1}>
            {map.name}
            {map.needsReview && <span className={styles.review}>needs review</span>}
          </h1>
          <span className={styles.desc}>{map.description}</span>
        </div>
        <div style={{ flex: 1 }} />
        {ovCount > 0 && (
          <button className="btn" onClick={() => resetOverrides(map.id)} title="Go back to the map's own entries">
            Reset {ovCount} override{ovCount > 1 ? 's' : ''}
          </button>
        )}
        <div role="radiogroup" aria-label="Filter rows" className={`seg ${styles.filter}`}>
          <button role="radio" aria-checked={filter === 'all'} onClick={() => setFilter('all')}>
            All {rows.length}
          </button>
          <button role="radio" aria-checked={filter === 'used'} onClick={() => setFilter('used')} disabled={!scan}>
            Used in riffs {scan ? usedCount : ''}
          </button>
          <button role="radio" aria-checked={filter === 'flagged'} onClick={() => setFilter('flagged')} title="Fixed, fallback, overridden or no sound">
            Flagged {flaggedCount}
          </button>
        </div>
      </div>

      <RemapBanner />

      <div role="table" aria-label="Note map" className={styles.table} data-names={hasNames || undefined}>
        <div role="row" className={`${styles.row} ${styles.headRow}`}>
          <span role="columnheader">Note</span>
          {hasNames && <span role="columnheader">Name in file</span>}
          <span role="columnheader">Plays</span>
          <span role="columnheader">In riffs</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">
            <span className="sr-only">Audition</span>
          </span>
        </div>
        {shown.map((r) => (
          <NoteRow key={r.note} row={r} mapId={map.id} scanned={!!scan} names={hasNames} />
        ))}
        {!shown.length && <div className={styles.emptyRow}>No notes match this filter.</div>}
      </div>
    </>
  );
}

const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function NoteRow({ row: r, mapId, scanned, names }: { row: Row; mapId: string; scanned: boolean; names: boolean }) {
  const value = r.override === null ? SILENT : (r.art ?? '');
  return (
    <div role="row" className={styles.row} data-status={r.status}>
      <span role="cell" className={styles.note}>
        {r.note}
      </span>
      {names && (
        <span role="cell" className={styles.src} title={r.src}>
          {r.src ?? '—'}
        </span>
      )}
      <span role="cell">
        <label className={styles.playsLabel}>
          <span className="sr-only">Note {r.note} plays</span>
          <select
            className={`select ${styles.plays}`}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') setNoteOverride(mapId, r.note, undefined);
              else if (v === SILENT) setNoteOverride(mapId, r.note, null);
              else {
                setNoteOverride(mapId, r.note, v);
                void engine.audition(v, 110);
              }
            }}
          >
            {!r.entry && <option value="">No sound (not assigned)</option>}
            <option value={SILENT}>{r.entry ? 'No sound' : 'No sound (on purpose)'}</option>
            {ART_GROUPS.map((g) => (
              <optgroup key={g.group} label={GROUP_LABEL[g.group]}>
                {g.arts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </span>
      <span role="cell" className={styles.used} data-used={!!r.used?.hits || undefined} title={r.used ? `${r.used.hits.toLocaleString()} hits in ${r.used.files.toLocaleString()} riffs` : undefined}>
        {r.used?.hits ? compact(r.used.hits) : scanned ? '—' : '?'}
      </span>
      <span role="cell" className={styles.statusCell}>
        <span className={styles.chip} data-s={r.status}>
          {STATUS_LABEL[r.status]}
        </span>
        <span className={styles.why} title={r.why}>
          {r.why}
        </span>
        {r.override !== undefined && (
          <button className={styles.reset} onClick={() => setNoteOverride(mapId, r.note, undefined)} title="Go back to the map's own entry">
            Reset
          </button>
        )}
      </span>
      <span role="cell">
        <button
          className={styles.audition}
          aria-label={`Audition note ${r.note}`}
          title={r.art ? `Play ${ART_BY_ID[r.art]?.name ?? r.art}` : 'No sound'}
          disabled={!r.art}
          onClick={() => r.art && void engine.audition(r.art, 110)}
        >
          <I.Play size={11} />
        </button>
      </span>
    </div>
  );
}
