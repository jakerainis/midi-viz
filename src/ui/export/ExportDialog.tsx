/**
 * Export: MIDI or a 24-bit WAV of the whole song, some sections, the selected clip(s) or the loop. The work lives
 * in src/export; this is the form around it.
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { engine } from '../../audio/engine';
import { midiFromPlan } from '../../export/midi';
import { DEFAULT_NAME_PATTERN, NAME_TOKENS, fileBaseName, formatNumber, uniqueNames } from '../../export/naming';
import { NATIVE_MAP_ID, ORIGINAL_NOTES, barSpan, buildPlan, clipsSpan, jobsFor, sectionsInOrder } from '../../export/plan';
import type { Job, Scope } from '../../export/plan';
import { channelsOf, kitSampleRate, renderPlan, renderSeconds } from '../../export/render';
import { canPickFolder, canWrite, downloadFiles, loadFolder, pickFolder, writeToFolder } from '../../export/save';
import type { OutFile } from '../../export/save';
import { encodeWav } from '../../export/wav';
import { audibleTracks, songEnd } from '../../model/compile';
import { ART_BY_ID } from '../../model/kit';
import { NOTE_MAPS } from '../../model/noteMaps';
import { MeterMap, barTicksFor } from '../../model/timing';
import type { Song } from '../../model/types';
import { setOverlay, useApp } from '../../state/store';
import * as I from '../icons';
import styles from './Export.module.css';

type Format = 'midi' | 'audio';

interface Options {
  tempoChanges: boolean;
  markers: boolean;
  humanize: boolean;
}

/** Remembered between exports. What to export is picked fresh from the selection each time. */
interface Settings {
  format: Format;
  noteMode: string;
  joined: boolean;
  pattern: string;
  options: Options;
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string };

const SETTINGS_KEY = 'midi-viz:export:v1';

const DEFAULTS: Settings = {
  format: 'midi',
  noteMode: NATIVE_MAP_ID,
  joined: false,
  pattern: DEFAULT_NAME_PATTERN,
  options: { tempoChanges: true, markers: true, humanize: false },
};

const mapById = (id: string) => NOTE_MAPS.find((m) => m.id === id);

/** As in the design: the plugin's notes, General MIDI, the source notes, then the pack maps. */
const NOTE_OPTIONS = [
  ...[NATIVE_MAP_ID, 'gm'].flatMap((id) => {
    const m = mapById(id);
    return m ? [{ id: m.id, name: m.name }] : [];
  }),
  { id: ORIGINAL_NOTES, name: "Each riff's original notes" },
  ...NOTE_MAPS.filter((m) => m.id !== NATIVE_MAP_ID && m.id !== 'gm').map((m) => ({ id: m.id, name: m.name })),
];

const OPTION_ROWS: { key: keyof Options; midi?: string; audio?: string; title: string }[] = [
  {
    key: 'tempoChanges',
    midi: 'Tempo and time-signature changes',
    title: 'Off: only the tempo and time signature where the export starts',
  },
  { key: 'markers', midi: 'Section names as markers', title: 'A marker wherever a section starts' },
  {
    key: 'humanize',
    midi: 'Bake in humanize and velocity curve',
    audio: 'Humanize timing and velocity',
    title: "Each clip's random timing and velocity, with a fixed seed so the same export gives the same file. Off: exactly on the grid",
  },
];

function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (raw && typeof raw === 'object') {
      const s: Settings = { ...DEFAULTS, ...raw, options: { ...DEFAULTS.options, ...raw.options } };
      if (!NOTE_OPTIONS.some((o) => o.id === s.noteMode)) s.noteMode = NATIVE_MAP_ID;
      if (s.format !== 'midi' && s.format !== 'audio') s.format = 'midi';
      if (typeof s.pattern !== 'string') s.pattern = DEFAULT_NAME_PATTERN;
      return s;
    }
  } catch {
    /* private mode or bad JSON */
  }
  return DEFAULTS;
}

function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Selected clips, else the selected section, else the whole song. */
function initialChoice(): { scope: Scope; sectionIds: string[] } {
  const st = useApp.getState();
  const { song } = st;
  const clipIds = st.focus === 'editor' && st.editClipId ? [st.editClipId] : st.selectedClipIds;
  const section = song.sections.find((s) => s.id === st.selectedSectionId);
  const sectionIds = section ? [section.id] : song.sections.map((s) => s.id);
  if (clipsSpan(song, clipIds)) return { scope: 'clips', sectionIds };
  if (section) return { scope: 'sections', sectionIds };
  return { scope: 'song', sectionIds };
}

const barsText = (bars: number) => `${formatNumber(bars)} bar${Math.abs(bars - 1) < 1e-6 ? '' : 's'}`;
const filesText = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function listNames(arts: string[]) {
  return arts.map((a) => ART_BY_ID[a]?.name ?? a).join(', ');
}

function errorText(err: unknown) {
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'the folder is gone. Choose another one.';
  if (err instanceof Error) return err.message;
  return String(err);
}

const folderName = (dir: FileSystemDirectoryHandle) => dir.name || 'the chosen folder';

/** Sequence name written into the MIDI file. */
function title(song: Song, job: Job) {
  return job.section ? `${song.name} - ${job.section}` : song.name;
}

const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 1.5h4l2.5 2.5v6.5H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const PICKER = canPickFolder();

export function ExportDialog() {
  const song = useApp((s) => s.song);
  const focus = useApp((s) => s.focus);
  const editClipId = useApp((s) => s.editClipId);
  const selectedClipIds = useApp((s) => s.selectedClipIds);
  const velCurve = useApp((s) => s.prefs.velCurve);
  const masterDb = useApp((s) => s.prefs.masterDb);
  const kit = useApp((s) => s.kit);

  const [initial] = useState(initialChoice);
  const [scope, setScope] = useState<Scope>(initial.scope);
  const [sectionIds, setSectionIds] = useState<string[]>(initial.sectionIds);
  const [settings, setSettings] = useState(readSettings);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const running = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { format, noteMode, joined, pattern, options } = settings;
  /** A finished export's message goes once the choice changes. */
  const clearStatus = () => setStatus((s) => (s.kind === 'busy' || s.kind === 'idle' ? s : { kind: 'idle', text: '' }));
  const patch = (p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }));
    clearStatus();
  };
  const setOption = (key: keyof Options, on: boolean) => {
    setSettings((s) => ({ ...s, options: { ...s.options, [key]: on } }));
    clearStatus();
  };
  const choose = (next: Scope) => {
    setScope(next);
    clearStatus();
  };

  useEffect(() => writeSettings(settings), [settings]);
  useEffect(() => dialogRef.current?.focus(), []);

  useEffect(() => {
    let live = true;
    void loadFolder().then((dir) => {
      if (live && dir) setFolder((f) => f ?? dir);
    });
    return () => {
      live = false;
    };
  }, []);

  // ---- what there is to export ----

  const meter = useMemo(() => new MeterMap(song.meter), [song.meter]);
  const sections = useMemo(() => sectionsInOrder(song), [song]);
  const end = useMemo(() => songEnd(song), [song]);
  const clipIds = useMemo(
    () =>
      (focus === 'editor' && editClipId ? [editClipId] : selectedClipIds).filter((id) =>
        song.clips.some((c) => c.id === id && song.patterns[c.patternId]),
      ),
    [focus, editClipId, selectedClipIds, song.clips, song.patterns],
  );
  const loopOn = song.loop.on && song.loop.end > song.loop.start;
  const pickedCount = sections.filter((s) => sectionIds.includes(s.id)).length;
  const canJoin = scope === 'sections' && pickedCount > 1;
  const mapMode = format === 'midi' ? noteMode : NATIVE_MAP_ID;

  const jobs = useMemo(
    () => jobsFor(song, { scope, sectionIds, joined: joined && canJoin, clipIds }),
    [song, scope, sectionIds, joined, canJoin, clipIds],
  );
  const plans = useMemo(
    () => jobs.map((j) => buildPlan(song, j, { humanize: options.humanize, noteMode: mapMode })),
    [song, jobs, options.humanize, mapMode],
  );
  const ext = format === 'midi' ? '.mid' : '.wav';
  const names = useMemo(
    () =>
      uniqueNames(
        jobs.map(
          (j) =>
            fileBaseName(pattern.trim() || DEFAULT_NAME_PATTERN, { song: song.name, n: j.n, section: j.section, bpm: j.bpm, bars: j.bars }) +
            ext,
        ),
      ),
    [jobs, pattern, song.name, ext],
  );

  const kitReady = kit.status === 'ready' && !!engine.kit;
  const busy = status.kind === 'busy';
  const canExport = jobs.length > 0 && !busy && (format === 'midi' || kitReady);

  // ---- export ----

  async function run() {
    if (!canExport || running.current) return;
    running.current = true;
    setStatus({ kind: 'busy', text: 'Exporting…' });
    try {
      let dir: FileSystemDirectoryHandle | null = null;
      if (PICKER) {
        dir = folder ?? (await pickFolder());
        if (!dir) {
          setStatus({ kind: 'idle', text: '' });
          return;
        }
        if (dir !== folder) setFolder(dir);
        if (!(await canWrite(dir))) {
          setStatus({ kind: 'error', text: `No permission to save in ${folderName(dir)}. Choose the folder again.` });
          return;
        }
      }
      const files: OutFile[] = [];
      for (let i = 0; i < jobs.length; i++) {
        if (format === 'midi') {
          const bytes = midiFromPlan(plans[i], {
            name: title(song, jobs[i]),
            tempoChanges: options.tempoChanges,
            markers: options.markers,
            velCurve: options.humanize ? velCurve : 1,
          });
          files.push({ name: names[i], blob: new Blob([bytes], { type: 'audio/midi' }) });
        } else {
          const loaded = engine.kit;
          if (!loaded) throw new Error('the kit is not loaded.');
          setStatus({ kind: 'busy', text: jobs.length > 1 ? `Rendering ${i + 1} of ${jobs.length}…` : 'Rendering…' });
          const buf = await renderPlan(plans[i], loaded, {
            tracks: song.tracks,
            masterDb,
            velCurve,
            seed: `${song.id}:${jobs[i].pieces[0].from}`,
          });
          files.push({ name: names[i], blob: new Blob([encodeWav(channelsOf(buf), buf.sampleRate)], { type: 'audio/wav' }) });
        }
      }
      setStatus({ kind: 'busy', text: 'Saving…' });
      if (dir) {
        const { replaced } = await writeToFolder(dir, files);
        setStatus({ kind: 'ok', text: `Saved ${filesText(files.length)} to ${folderName(dir)}${replaced ? ` (${replaced} replaced)` : ''}.` });
      } else {
        await downloadFiles(files);
        setStatus({ kind: 'ok', text: `Downloaded ${filesText(files.length)}.` });
      }
    } catch (err) {
      console.error('Export failed', err);
      setStatus({ kind: 'error', text: `Export failed: ${errorText(err)}` });
    } finally {
      running.current = false;
    }
  }

  async function changeFolder() {
    try {
      const dir = await pickFolder(folder);
      if (dir) {
        setFolder(dir);
        setStatus({ kind: 'idle', text: '' });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: `Couldn't open that folder: ${errorText(err)}` });
    }
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      // Also stops Enter from pressing whichever button has focus.
      e.preventDefault();
      void run();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- labels ----

  // Muted tracks stay out of the song, sections and loop (a clip picked by hand is written anyway).
  const audible = audibleTracks(song.tracks);
  const withClips = new Set(song.clips.map((c) => c.trackId));
  const heard = song.tracks.filter((t) => withClips.has(t.id) && audible.has(t.id)).length;
  const silent = song.tracks.filter((t) => withClips.has(t.id) && !audible.has(t.id)).length;
  const songSub =
    end > 0
      ? `${barsText(Math.ceil(meter.barAt(end) - 1e-6))} · ${heard} track${heard === 1 ? '' : 's'} ${
          format === 'midi' ? 'merged to one drum part' : 'mixed to one file'
        }${silent ? ` · ${silent} muted, left out` : ''}`
      : 'The song is empty';

  let clipSub = 'Select a clip in the arrangement first';
  if (clipIds.length === 1) {
    const c = song.clips.find((x) => x.id === clipIds[0])!;
    const p = song.patterns[c.patternId];
    const clipBars = c.length / barTicksFor(p.meter[0], p.meter[1]);
    const passes = c.length / Math.max(1, c.loopEnd - c.loopStart);
    clipSub = `${p.name} · ${barsText(clipBars)}${passes > 1.005 ? ` (the riff ×${Math.round(passes * 100) / 100})` : ''}`;
  } else if (clipIds.length > 1) {
    const span = clipsSpan(song, clipIds)!;
    clipSub = `${clipIds.length} clips · bars ${barSpan(meter, span.from, span.to).label}`;
  }

  const scopes: { id: Scope; name: string; sub: string; disabled: boolean }[] = [
    { id: 'song', name: 'Whole song', sub: songSub, disabled: end <= 0 },
    {
      id: 'sections',
      name: 'Sections',
      sub: sections.length ? 'Pick from the markers below' : 'No section markers yet · ⇧M adds one',
      disabled: !sections.length,
    },
    { id: 'clips', name: clipIds.length > 1 ? 'Selected clips' : 'Selected clip', sub: clipSub, disabled: !clipIds.length },
    {
      id: 'loop',
      name: 'Loop range',
      sub: loopOn ? `Bars ${barSpan(meter, song.loop.start, song.loop.end).label}` : 'The loop is off',
      disabled: !loopOn,
    },
  ];

  const emptyText: Record<Scope, string> = {
    song: 'The song is empty.',
    sections: 'Tick at least one section.',
    clips: 'Select a clip in the arrangement first.',
    loop: 'Turn the loop on first.',
  };

  const warnings: string[] = [];
  if (format === 'midi' && noteMode !== ORIGINAL_NOTES) {
    const mapName = NOTE_OPTIONS.find((o) => o.id === noteMode)?.name ?? 'This map';
    const subs = new Map(plans.flatMap((p) => p.substituted).map((x) => [x.art, x.as]));
    const dropped = [...new Set(plans.flatMap((p) => p.droppedArts))];
    if (subs.size) {
      const list = [...subs].map(([art, as]) => `${listNames([art])} as ${listNames([as])}`).join(', ');
      warnings.push(`${mapName} has no note for some hits. Written as the nearest drum: ${list}.`);
    }
    if (dropped.length) warnings.push(`${mapName} has nothing for ${listNames(dropped)}. Those hits are left out.`);
  }
  if (format === 'audio' && !kitReady) {
    warnings.push(kit.status === 'error' ? 'The kit failed to load, so there is nothing to render with.' : 'The kit is still loading.');
  }

  const fileMeta = (i: number) => {
    const bars = barsText(jobs[i].bars);
    if (format === 'midi') return `${bars} · Type 1${plans[i].events.length ? '' : ' · no notes'}`;
    return `${bars} · ${clock(renderSeconds(plans[i]))} · 24-bit`;
  };

  let where: ReactNode = "Saves to your browser's downloads folder.";
  if (PICKER) {
    where = folder ? (
      <>
        Saves to <span className="mono">{folderName(folder)}</span> ·{' '}
        <button type="button" className={styles.link} onClick={() => void changeFolder()}>
          Change folder
        </button>
      </>
    ) : (
      <>
        Asks where to save the first time ·{' '}
        <button type="button" className={styles.link} onClick={() => void changeFolder()}>
          Choose folder
        </button>
      </>
    );
  }

  const sampleRate = engine.kit && kitReady ? `${formatNumber(kitSampleRate(engine.kit) / 1000)} kHz` : '';

  return (
    <div className={styles.scrim} onPointerDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" className={styles.dialog} tabIndex={-1} ref={dialogRef}>
        <div className={styles.head}>
          <h1 id="export-title">Export</h1>
          <div role="group" aria-label="Format" className={`seg ${styles.format}`}>
            <button aria-pressed={format === 'midi'} onClick={() => patch({ format: 'midi' })}>
              MIDI
            </button>
            <button aria-pressed={format === 'audio'} title="24-bit WAV" onClick={() => patch({ format: 'audio' })}>
              Audio
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <button className={`icon-btn ${styles.close}`} aria-label="Close" onClick={() => setOverlay(null)}>
            <I.Close />
          </button>
        </div>

        <div className={styles.body}>
          <fieldset className={styles.what}>
            <legend className="eyebrow">What</legend>
            {scopes.map((s) => (
              <label key={s.id} className={styles.scope} data-on={scope === s.id} data-disabled={s.disabled}>
                <input type="radio" name="export-scope" checked={scope === s.id} disabled={s.disabled} onChange={() => choose(s.id)} />
                <span className={styles.scopeText}>
                  <span className={styles.scopeName}>{s.name}</span>
                  <span className={styles.scopeSub}>{s.sub}</span>
                </span>
              </label>
            ))}
            {sections.length > 0 && (
              <div className={styles.sections} data-dim={scope !== 'sections'} role="group" aria-label="Sections">
                {sections.map((s) => (
                  <label key={s.id} className={styles.section}>
                    <input
                      type="checkbox"
                      checked={sectionIds.includes(s.id)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        choose('sections');
                        setSectionIds((ids) => (on ? [...ids.filter((x) => x !== s.id), s.id] : ids.filter((x) => x !== s.id)));
                      }}
                    />
                    <span className={styles.swatch} style={{ background: s.color }} />
                    <span className={styles.sectionName}>{s.name}</span>
                    <span className={styles.sectionBars}>{barSpan(meter, s.start, s.end).label}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className={styles.how}>
            <fieldset className={styles.filesGroup}>
              <legend className="eyebrow">Files</legend>
              <div role="group" aria-label="Files" className={`seg ${styles.filesSeg}`}>
                <button aria-pressed={!joined || !canJoin} disabled={!canJoin} onClick={() => patch({ joined: false })}>
                  One per section
                </button>
                <button
                  aria-pressed={joined && canJoin}
                  disabled={!canJoin}
                  title="The ticked sections back to back, in song order"
                  onClick={() => patch({ joined: true })}
                >
                  Joined into one
                </button>
              </div>
            </fieldset>

            {format === 'midi' ? (
              <label className={styles.field}>
                <span className="eyebrow">Write notes as</span>
                <select className="select" value={noteMode} onChange={(e) => patch({ noteMode: e.target.value })}>
                  {NOTE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className={styles.field}>
                <span className="eyebrow">Kit</span>
                <span className={styles.kitInfo}>
                  {kit.name}
                  {sampleRate && ` · ${sampleRate} · 24-bit WAV`}
                </span>
              </div>
            )}

            <div className={styles.options}>
              {OPTION_ROWS.map((o) => {
                const label = format === 'midi' ? o.midi : o.audio;
                if (!label) return null;
                return (
                  <label key={o.key} className={styles.option} title={o.title}>
                    <input type="checkbox" checked={options[o.key]} onChange={(e) => setOption(o.key, e.target.checked)} />
                    {label}
                  </label>
                );
              })}
            </div>

            <label className={styles.field}>
              <span className="eyebrow">File names</span>
              <input
                className="input"
                type="text"
                spellCheck={false}
                value={pattern}
                placeholder={DEFAULT_NAME_PATTERN}
                aria-describedby="export-tokens"
                onChange={(e) => patch({ pattern: e.target.value })}
              />
              <span id="export-tokens" className={styles.hint}>
                {NAME_TOKENS.join(' ')}
              </span>
            </label>
          </div>
        </div>

        <div className={styles.files} aria-label="Files to write">
          {jobs.length ? (
            jobs.map((j, i) => (
              <div key={`${j.n}:${j.pieces[0].from}`} className={styles.file}>
                <FileIcon />
                <span className={styles.fileName} title={names[i]}>
                  {names[i]}
                </span>
                <span className={styles.fileMeta}>{fileMeta(i)}</span>
              </div>
            ))
          ) : (
            <div className={styles.empty}>{emptyText[scope]}</div>
          )}
          {warnings.map((w) => (
            <div key={w} className={styles.warn}>
              <I.Warn />
              <span>{w}</span>
            </div>
          ))}
        </div>

        <div role="status" className={styles.status} data-kind={status.kind}>
          {status.text}
        </div>

        <div className={styles.foot}>
          <span className={styles.where}>{where}</span>
          <button className={`btn ${styles.cancel}`} onClick={() => setOverlay(null)}>
            {status.kind === 'ok' ? 'Close' : 'Cancel'}
          </button>
          <button className={`btn btn-primary ${styles.go}`} disabled={!canExport} onClick={() => void run()}>
            {busy ? 'Exporting…' : `Export ${filesText(jobs.length)}`}
            <kbd>⌘↩</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
