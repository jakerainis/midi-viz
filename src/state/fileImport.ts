/** Importing the user's own MIDI files: picks the note map that explains the most notes, then drops them in. */
import { engine } from '../audio/engine';
import { hitsFromRaw, meterFromName, readMidi } from '../model/importMidi';
import { newClip, uid } from '../model/types';
import type { Pattern } from '../model/types';
import { edit, useApp } from './store';

const CANDIDATES = ['gm', 'ugritone', 'ugritone-classic', 'kvlt2'];

export async function importMidiFiles(files: File[]) {
  if (!files.length) return;
  const patterns: Pattern[] = [];
  for (const f of files) {
    try {
      const raw = readMidi(await f.arrayBuffer(), meterFromName(f.name));
      // The map that leaves the fewest notes without a sound wins; GM breaks ties.
      let best = { mapId: 'gm', missing: Infinity };
      for (const id of CANDIDATES) {
        const { unmapped } = hitsFromRaw(raw, id);
        const missing = unmapped.reduce((n, u) => n + u.count, 0);
        if (missing < best.missing) best = { mapId: id, missing };
      }
      const { hits, unmapped } = hitsFromRaw(raw, best.mapId, useApp.getState().mapping.overrides[best.mapId]);
      const name = f.name.replace(/\.midi?$/i, '');
      patterns.push({
        id: uid('p'),
        name,
        lengthTicks: raw.lengthTicks,
        meter: raw.meter,
        bpm: raw.bpm,
        source: { pack: 'Imported', file: f.name, mapId: best.mapId },
        hits,
        unmapped: unmapped.length ? unmapped : undefined,
      });
    } catch (err) {
      console.error('MIDI import failed', f.name, err);
      alert(`Couldn't read ${f.name}`);
    }
  }
  if (!patterns.length) return;
  const st = useApp.getState();
  const trackId = st.selectedTrackId ?? st.song.tracks[0]?.id;
  if (!trackId) return;
  // Start at the playhead, after anything already on the track there.
  let at = Math.round(engine.position());
  const newIds: string[] = [];
  edit((s) => {
    for (const p of patterns) {
      s.patterns[p.id] = p;
      const c = newClip(trackId, p, at);
      newIds.push(c.id);
      s.clips.push(c);
      at += c.length;
    }
  });
  useApp.setState({ selectedClipIds: newIds, editClipId: newIds[0] });
}
