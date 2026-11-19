/**
 * Right-hand panel: selected notes (while the clip editor has focus), the selected clip (length, crop, note map,
 * feel), its track, or the song.
 */
import { engine } from '../../audio/engine';
import { MAP_BY_ID } from '../../model/noteMaps';
import { DEFAULT_FEEL, PPQ, clipCycles, clipEnd, loopLength } from '../../model/types';
import type { Clip, Feel, Pattern, Song, Track } from '../../model/types';
import { reloadPattern } from '../../state/riffs';
import { checkpoint, setArrange, setOverlay, setView, useApp } from '../../state/store';
import {
  loopVisiblePart,
  loopWholeRiff,
  makeUnique,
  matchMeterToClip,
  patternUses,
  removeTrack,
  replacePattern,
  setTempoAt,
  stepRepeat,
  updateClip,
  updateTrack,
} from '../../state/songActions';
import { SelectionPanel } from '../editor/SelectionPanel';
import { useMaps } from '../hooks';
import * as I from '../icons';
import styles from './Inspector.module.css';

export function Inspector() {
  const song = useApp((s) => s.song);
  const selected = useApp((s) => s.selectedClipIds);
  const trackId = useApp((s) => s.selectedTrackId);
  const clip = selected.length === 1 ? song.clips.find((c) => c.id === selected[0]) : undefined;
  const pattern = clip && song.patterns[clip.patternId];
  const track = song.tracks.find((t) => t.id === (clip?.trackId ?? trackId));
  const focus = useApp((s) => s.focus);
  const hitCount = useApp((s) => s.selectedHitIds.length);
  const editClipId = useApp((s) => s.editClipId);
  const editClip = song.clips.find((c) => c.id === editClipId);
  const editPattern = editClip && song.patterns[editClip.patternId];

  if (focus === 'editor' && hitCount > 0 && editClip && editPattern) {
    return (
      <div className={styles.panel}>
        <SelectionPanel clip={editClip} pattern={editPattern} />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {clip && pattern ? (
        <ClipPanel song={song} clip={clip} pattern={pattern} />
      ) : selected.length > 1 ? (
        <div className={styles.block}>
          <span className="eyebrow">Selection</span>
          <span className={styles.title}>{selected.length} clips</span>
          <p className={styles.note}>⌘D duplicates them after themselves, ⇧⌘D makes linked copies, ⌘J joins touching copies of the same riff.</p>
        </div>
      ) : (
        <SongPanel song={song} />
      )}
      {track && <TrackPanel track={track} />}
      <div className={styles.actions}>
        <button
          className="btn"
          style={{ flex: 1, height: 36 }}
          disabled={!clip}
          onClick={() => {
            if (clip) useApp.setState({ editClipId: clip.id, focus: 'editor' });
            setArrange({ showDock: true });
          }}
        >
          Edit notes
        </button>
        <button className="btn" style={{ flex: 1, height: 36 }} onClick={() => setOverlay('export')}>
          {clip ? 'Export clip' : 'Export'}
        </button>
      </div>
    </div>
  );
}

function ClipPanel({ song, clip, pattern }: { song: Song; clip: Clip; pattern: Pattern }) {
  const { meter } = useMaps();
  const bar = (t: number) => Math.round(meter.barAt(t) * 100) / 100 + 1;
  const bars = pattern.lengthTicks / (PPQ * 4);
  const map = MAP_BY_ID[pattern.source?.mapId ?? ''];
  const linked = patternUses(song, pattern.id);
  const feel = clip.feel ?? DEFAULT_FEEL;
  const setFeel = (patch: Partial<Feel>, history = false) => updateClip(clip.id, { feel: { ...feel, ...patch } }, history);
  const missing = pattern.unmapped?.reduce((n, u) => n + u.count, 0) ?? 0;
  const songMeter = meter.meterAt(clip.start);
  const meterDiffers = songMeter.num !== pattern.meter[0] || songMeter.den !== pattern.meter[1];
  const songBpm = engine.tempo.bpmAt(clip.start);
  const L = loopLength(clip);
  const barTicks = (PPQ * 4 * pattern.meter[0]) / pattern.meter[1];
  const riffBar = (t: number) => Math.round((t / barTicks) * 100) / 100 + (t === clip.loopEnd ? 0 : 1);
  const loopWhole = clip.loopStart === 0 && clip.loopEnd === pattern.lengthTicks;
  const canLoopPart = clip.length < L && clip.offset + clip.length <= L;
  const passes = clipCycles(clip);
  const lenBars = clip.length / meter.barLength(clip.start);
  const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));
  const passLabel = `${fmt(lenBars)} bar${fmt(lenBars) === '1' ? '' : 's'}${Math.abs(passes - 1) > 0.005 ? ` · ×${fmt(passes)}` : ''}`;

  return (
    <>
      <div className={styles.block} style={{ gap: 4 }}>
        <span className="eyebrow">Clip</span>
        <span className={styles.title}>{pattern.name}</span>
        <span className={styles.path}>{pattern.source ? `${pattern.source.pack.trim()}/${pattern.source.file}` : 'Made here'}</span>
      </div>

      <div className={styles.grid}>
        <span className={styles.k}>Position</span>
        <span className="mono">
          {bar(clip.start)} → {bar(clipEnd(clip, pattern))}
        </span>
        <span className={styles.k}>Riff</span>
        <span>
          {bars % 1 ? bars.toFixed(2) : bars} bar{bars === 1 ? '' : 's'} · {pattern.meter[0]}/{pattern.meter[1]}
          {pattern.bpm ? ` · ${pattern.bpm} bpm` : ''}
          {pattern.bpm && Math.abs(pattern.bpm - songBpm) > 0.05 && (
            <>
              {' · '}
              <button className={styles.link} onClick={() => setTempoAt(clip.start, pattern.bpm!)} title={`The song is at ${songBpm} bpm here`}>
                Use its tempo here
              </button>
            </>
          )}
        </span>
        {meterDiffers && (
          <>
            <span className={styles.k}>Meter</span>
            <span>
              Song is {songMeter.num}/{songMeter.den} here ·{' '}
              <button className={styles.link} onClick={() => matchMeterToClip(clip.id)}>
                Use {pattern.meter[0]}/{pattern.meter[1]}
              </button>
            </span>
          </>
        )}
        <span className={styles.k}>Length</span>
        <div className={styles.stepper}>
          <button className="btn" aria-label="One pass less" title="⇧R" onClick={() => stepRepeat(clip.id, -1)}>
            −
          </button>
          <span className="mono">{passLabel}</span>
          <button className="btn" aria-label="One pass more" title="R" onClick={() => stepRepeat(clip.id, 1)}>
            +
          </button>
        </div>
        <span className={styles.k} title="The part of the riff that repeats when you drag the clip longer">
          Loops
        </span>
        <span>
          {loopWhole ? 'The whole riff' : `Bars ${riffBar(clip.loopStart)}–${riffBar(clip.loopEnd)} of the riff`}
          {canLoopPart && (
            <>
              {' · '}
              <button className={styles.link} onClick={() => loopVisiblePart(clip.id)} title="Repeat just the part this clip shows, e.g. a fill bar">
                Repeat just this part
              </button>
            </>
          )}
          {!loopWhole && (
            <>
              {' · '}
              <button className={styles.link} onClick={() => loopWholeRiff(clip.id)}>
                Repeat the whole riff
              </button>
            </>
          )}
        </span>
        <span className={styles.k} title="Where this clip's notes come from">
          Notes
        </span>
        <span>
          {linked > 1 ? (
            <>
              Shared with {linked - 1} other clip{linked > 2 ? 's' : ''} ·{' '}
              <button className={styles.link} onClick={() => makeUnique(clip.id)} title="Give this clip its own copy, so edits only change it">
                Make unique
              </button>
            </>
          ) : !pattern.source ? (
            'Drawn here'
          ) : pattern.edited ? (
            <>
              Edited
              {pattern.source && (
                <>
                  {' · '}
                  <button
                    className={styles.link}
                    onClick={async () => {
                      const p = await reloadPattern(pattern);
                      if (p) replacePattern(p);
                    }}
                  >
                    Revert to file
                  </button>
                </>
              )}
            </>
          ) : (
            'As in the file'
          )}
        </span>
      </div>

      {missing > 0 && (
        <div className={styles.status} style={{ color: 'var(--warn)' }}>
          <I.Warn />
          <span>
            {missing} hit{missing > 1 ? 's' : ''} on note{pattern.unmapped!.length > 1 ? 's' : ''} {pattern.unmapped!.map((u) => u.note).join(', ')} play nothing in the{' '}
            {map?.name ?? ''} note map ·{' '}
            <button className={styles.link} onClick={() => setView('mapping')}>
              Assign a sound
            </button>
          </span>
        </div>
      )}

      <div className={styles.block} style={{ gap: 12 }}>
        <span className="eyebrow">Feel</span>
        <div className={styles.sliderRow}>
          <span>Velocity range</span>
          <span className="mono">
            {feel.velMin} – {feel.velMax}
          </span>
        </div>
        <div className={styles.dual}>
          <input
            type="range"
            min={1}
            max={127}
            value={feel.velMin}
            aria-label="Lowest velocity"
            onPointerDown={checkpoint}
            onChange={(e) => setFeel({ velMin: Math.min(Number(e.target.value), feel.velMax - 1) })}
          />
          <input
            type="range"
            min={1}
            max={127}
            value={feel.velMax}
            aria-label="Highest velocity"
            onPointerDown={checkpoint}
            onChange={(e) => setFeel({ velMax: Math.max(Number(e.target.value), feel.velMin + 1) })}
          />
        </div>
        <label className={styles.slider}>
          <span className={styles.sliderRow}>
            <span>Humanize timing</span>
            <span className="mono">±{feel.humanizeMs} ms</span>
          </span>
          <input type="range" min={0} max={20} value={feel.humanizeMs} onPointerDown={checkpoint} onChange={(e) => setFeel({ humanizeMs: Number(e.target.value) })} />
        </label>
        <label className={styles.slider}>
          <span className={styles.sliderRow}>
            <span>Humanize velocity</span>
            <span className="mono">±{feel.humanizeVel}</span>
          </span>
          <input type="range" min={0} max={30} value={feel.humanizeVel} onPointerDown={checkpoint} onChange={(e) => setFeel({ humanizeVel: Number(e.target.value) })} />
        </label>
      </div>
    </>
  );
}

function TrackPanel({ track }: { track: Track }) {
  return (
    <div className={styles.block}>
      <span className="eyebrow">Track · {track.name}</span>
      <label className={styles.slider}>
        <span className={styles.sliderRow}>
          <span>Volume</span>
          <span className="mono">{track.volumeDb <= -60 ? '−∞' : `${track.volumeDb > 0 ? '+' : track.volumeDb < 0 ? '−' : ''}${Math.abs(track.volumeDb).toFixed(1)} dB`}</span>
        </span>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={track.volumeDb}
          onPointerDown={checkpoint}
          onDoubleClick={() => updateTrack(track.id, { volumeDb: 0 })}
          onChange={(e) => updateTrack(track.id, { volumeDb: Number(e.target.value) }, false)}
        />
      </label>
      <button
        className={styles.danger}
        onClick={() => {
          if (confirm(`Delete the track “${track.name}” and its clips?`)) removeTrack(track.id);
        }}
      >
        Delete track
      </button>
    </div>
  );
}

function SongPanel({ song }: { song: Song }) {
  const { meter } = useMaps();
  const end = song.clips.reduce((m, c) => Math.max(m, clipEnd(c, song.patterns[c.patternId])), 0);
  const bars = Math.ceil(meter.barAt(end));
  return (
    <div className={styles.block} style={{ gap: 4 }}>
      <span className="eyebrow">Song</span>
      <span className={styles.title}>{song.name}</span>
      <span className={styles.stats}>
        {bars} bars · {song.tracks.length} tracks · {song.clips.length} clips · {Object.keys(song.patterns).length} riffs
      </span>
      <p className={styles.note}>
        Select a clip to see its riff, repeats and feel. Double-click a clip, or press Tab, to edit its notes. Starting at{' '}
        {Math.round(engine.tempo.bpmAt(0))} bpm{song.tempo.length > 1 ? ` with ${song.tempo.length - 1} tempo change${song.tempo.length > 2 ? 's' : ''}` : ''}.
      </p>
    </div>
  );
}
