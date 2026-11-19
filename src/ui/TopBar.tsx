import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { engine } from '../audio/engine';
import { useTransport } from '../audio/bridge';
import { formatBBT, formatClock } from '../model/timing';
import { clearSavedData, downloadSong, isSong } from '../state/persist';
import { migrateSong } from '../model/migrate';
import { buildDemoSong } from '../state/demo';
import { ACCENTS, loadSong, newSong, redo, setOverlay, setPrefs, setView, undo, useApp } from '../state/store';
import type { Theme, View } from '../state/store';
import { renameSong, setLoop } from '../state/songActions';
import { importMidiFiles } from '../state/fileImport';
import { useFrame, useMaps } from './hooks';
import { TempoPopover } from './TempoPopover';
import { MeterPopover } from './MeterPopover';
import * as I from './icons';
import styles from './TopBar.module.css';

const TABS: { key: View; label: string; hint: string }[] = [
  { key: 'arrange', label: 'Arrange', hint: 'Arrange and edit · 1 (Tab shows or hides the clip editor)' },
  { key: 'kit', label: 'Kit', hint: 'Kit & samples · 2' },
  { key: 'mapping', label: 'Mapping', hint: 'MIDI mapping · 3' },
];

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'Match system', icon: <I.Auto /> },
  { id: 'dark', label: 'Dark', icon: <I.Moon /> },
  { id: 'light', label: 'Light', icon: <I.Sun /> },
];

export function TopBar() {
  const view = useApp((s) => s.view);
  const name = useApp((s) => s.song.name);
  const dirty = useApp((s) => s.dirty);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const loopOn = useApp((s) => s.song.loop.on);
  const metronome = useApp((s) => s.metronome);
  const kit = useApp((s) => s.kit);
  const { playing, mode } = useTransport();
  const songPlaying = playing && mode === 'song';

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <I.Logo />
        <span className={styles.logo}>midi-viz</span>
        <ProjectMenu name={name} />
        <span className={styles.saved}>{dirty ? 'Saving…' : 'Saved'}</span>
      </div>

      <nav aria-label="Views" className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t.key} title={t.hint} aria-current={view === t.key ? 'page' : undefined} onClick={() => setView(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className={styles.transport}>
        <button className="icon-btn" aria-label="Return to start" title="Return to start · Home" onClick={() => engine.seek(0)}>
          <I.ToStart />
        </button>
        <button
          className={styles.play}
          aria-label={songPlaying ? 'Stop' : 'Play'}
          title="Play / stop · Space"
          onClick={() => (songPlaying ? engine.stop() : void engine.play())}
        >
          {songPlaying ? <I.Stop /> : <I.Play />}
        </button>
        <button className="icon-btn" aria-label="Loop" aria-pressed={loopOn} title="Loop · L" onClick={() => setLoop({ on: !loopOn }, true)}>
          <I.Loop />
        </button>
        <button
          className="icon-btn"
          aria-label="Metronome"
          aria-pressed={metronome}
          title="Click · C"
          onClick={() => useApp.setState({ metronome: !metronome })}
        >
          <I.Metronome />
        </button>
      </div>

      <Lcd />

      {kit.status === 'loading' && !kit.playable && (
        <span className={styles.kitLoading} role="status">
          Loading drums… {Math.round(kit.progress * 100)}%
        </span>
      )}
      {kit.status === 'error' && (
        <button className={styles.kitError} onClick={() => setView('kit')} title={kit.error}>
          <I.Warn /> Drums didn't load
        </button>
      )}

      <div className={styles.spacer} />

      <div className={styles.right}>
        <button className="icon-btn" aria-label="Undo" title="Undo · ⌘Z" disabled={!canUndo} onClick={undo}>
          <I.Undo />
        </button>
        <button className="icon-btn" aria-label="Redo" title="Redo · ⇧⌘Z" disabled={!canRedo} onClick={redo}>
          <I.Redo />
        </button>
        <ThemeMenu />
        <button className={`icon-btn ${styles.help}`} aria-label="Keyboard shortcuts" title="Shortcuts · ?" onClick={() => setOverlay('shortcuts')}>
          ?
        </button>
        <button className={`btn btn-invert ${styles.export}`} title="Export · ⌘E" onClick={() => setOverlay('export')}>
          <I.Download />
          Export
        </button>
      </div>
    </header>
  );
}

/** Position, clock, tempo and meter at the playhead. Updated every frame without React renders. */
function Lcd() {
  const { tempo, meter } = useMaps();
  const multiTempo = useApp((s) => s.song.tempo.length > 1);
  const bbt = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const sig = useRef<HTMLSpanElement>(null);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const multiMeter = useApp((s) => s.song.meter.length > 1);
  useFrame(() => {
    const t = engine.position();
    const b = formatBBT(meter.bbt(t));
    const c = formatClock(tempo.seconds(t));
    const m = meter.meterAt(t);
    const bp = tempo.bpmAt(t).toFixed(1);
    if (bbt.current && bbt.current.textContent !== b) bbt.current.textContent = b;
    if (clock.current && clock.current.textContent !== c) clock.current.textContent = c;
    if (bpm.current && bpm.current.textContent !== bp) bpm.current.textContent = bp;
    const sg = `${m.num}/${m.den}`;
    if (sig.current && sig.current.textContent !== sg) sig.current.textContent = sg;
  });
  return (
    <div className={styles.lcd} aria-label="Position">
      <div style={{ minWidth: 92 }}>
        <span ref={bbt} className={styles.big}>
          1.1.1
        </span>
        <span ref={clock} className={styles.small}>
          00:00.000
        </span>
      </div>
      <div className={styles.lcdTempo}>
        <button className={styles.lcdBtn} aria-haspopup="dialog" aria-expanded={tempoOpen} title="Tempo: the song's, or a change at the playhead" onClick={() => setTempoOpen(!tempoOpen)}>
          <span ref={bpm} className={styles.big}>
            120.0
          </span>
          <span className={styles.small}>BPM{multiTempo ? ' · map' : ''}</span>
        </button>
        {tempoOpen && <TempoPopover onClose={() => setTempoOpen(false)} />}
      </div>
      <div className={styles.lcdTempo}>
        <button className={styles.lcdBtn} aria-haspopup="dialog" aria-expanded={sigOpen} title="Time signature: the song's, or a change at the playhead" onClick={() => setSigOpen(!sigOpen)}>
          <span ref={sig} className={styles.big}>
            4/4
          </span>
          <span className={styles.small}>{multiMeter ? 'sig · map' : 'sig'}</span>
        </button>
        {sigOpen && <MeterPopover onClose={() => setSigOpen(false)} />}
      </div>
    </div>
  );
}

function ProjectMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const midiRef = useRef<HTMLInputElement>(null);
  const close = () => setOpen(false);
  return (
    <div className={styles.menuWrap}>
      <button className={styles.project} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {name}
        <I.Chevron style={{ color: 'var(--muted)' }} />
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={close} />
          <div role="menu" className={styles.menu}>
            <button
              role="menuitem"
              onClick={() => {
                close();
                const n = prompt('Song name', name);
                if (n?.trim()) renameSong(n.trim());
              }}
            >
              Rename…
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                if (confirm('Start a new empty song? The current one is replaced (save it to a file first if you want to keep it).')) loadSong(newSong());
              }}
            >
              New song
            </button>
            <button
              role="menuitem"
              onClick={async () => {
                close();
                if (confirm('Replace the current song with the Grind demo?')) loadSong(await buildDemoSong());
              }}
            >
              Load Grind demo
            </button>
            <hr />
            <button role="menuitem" onClick={() => (close(), fileRef.current?.click())}>
              Open song file…
            </button>
            <button role="menuitem" onClick={() => (close(), downloadSong(useApp.getState().song))}>
              Save song to file
            </button>
            <hr />
            <button role="menuitem" onClick={() => (close(), midiRef.current?.click())}>
              Import MIDI files…
            </button>
            <hr />
            <button
              role="menuitem"
              onClick={() => {
                close();
                if (confirm('Clear the saved song and settings and start empty? Kits you loaded are kept.')) clearSavedData();
              }}
            >
              Start fresh (clear saved data)
            </button>
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!isSong(data)) throw new Error('Not a midi-viz song');
            loadSong(migrateSong(data));
          } catch (err) {
            alert(`Couldn't open that file: ${String(err)}`);
          }
        }}
      />
      <input
        ref={midiRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void importMidiFiles(files);
        }}
      />
    </div>
  );
}

function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const theme = useApp((s) => s.prefs.theme);
  const accent = useApp((s) => s.prefs.accent);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <div className={styles.menuWrap}>
      <button className="icon-btn" aria-label={`Theme: ${current.label}`} title="Theme" aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {current.icon}
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <div role="menu" className={`${styles.menu} ${styles.menuRight}`}>
            <span className="eyebrow" style={{ padding: '4px 10px' }}>
              Theme
            </span>
            {THEMES.map((t) => (
              <button key={t.id} role="menuitemradio" aria-checked={t.id === theme} onClick={() => setPrefs({ theme: t.id })}>
                {t.icon}
                {t.label}
              </button>
            ))}
            <hr />
            <span className="eyebrow" style={{ padding: '4px 10px' }}>
              Accent
            </span>
            <div className={styles.swatches}>
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  aria-label={`Accent ${c}`}
                  aria-pressed={c === accent}
                  style={{ background: c }}
                  onClick={() => setPrefs({ accent: c })}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
