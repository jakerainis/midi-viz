import { Midi } from '@tonejs/midi';
import { PPQ, uid } from './types';
import type { Hit, Pattern } from './types';
import { barTicksFor } from './timing';
import { MAP_BY_ID, resolveNote } from './noteMaps';

export interface ImportOptions {
  name: string;
  mapId: string;
  overrides?: Record<number, string | null>;
  source?: { pack: string; file: string };
}

/** Raw notes from a MIDI file, rescaled to the app's PPQ. Kept so a pattern can be re-mapped later. */
export interface RawMidi {
  notes: { tick: number; note: number; vel: number }[];
  lengthTicks: number;
  meter: [number, number];
  bpm?: number;
}

/** "3-4TripletBackBeat", "13-4-Proggy", "7-8 Groove" → the meter in the name, if any. */
export function meterFromName(name: string): [number, number] | undefined {
  // A meter is followed by more of the name ("3-4BombBlast", "Fill3-4_1"); "Groove5-2" at the end is a variant number.
  const m = name.replace(/\.midi?$/i, '').match(/(?:^|[^\d])(\d{1,2})-(2|4|8|16)(?=[A-Za-z_\s-])/);
  if (!m) return undefined;
  const num = Number(m[1]);
  return num >= 1 && num <= 32 ? [num, Number(m[2])] : undefined;
}

/** Parses a MIDI file. `meterHint` is used when the file has no time signature (most riff packs). */
export function readMidi(data: ArrayBuffer, meterHint?: [number, number]): RawMidi {
  const midi = new Midi(data);
  const scale = PPQ / (midi.header.ppq || 480);
  const ts = midi.header.timeSignatures[0]?.timeSignature;
  const meter: [number, number] = ts && ts[0] > 0 && ts[1] > 0 ? [ts[0], ts[1]] : (meterHint ?? [4, 4]);
  const bpm = midi.header.tempos[0]?.bpm;
  const notes: RawMidi['notes'] = [];
  let endOfTrack = 0;
  for (const track of midi.tracks) {
    endOfTrack = Math.max(endOfTrack, Math.round((track.endOfTrackTicks ?? 0) * scale));
    for (const n of track.notes) {
      notes.push({ tick: Math.round(n.ticks * scale), note: n.midi, vel: Math.max(1, Math.min(127, Math.round(n.velocity * 127))) });
    }
  }
  notes.sort((a, b) => a.tick - b.tick || a.note - b.note);
  const bar = barTicksFor(meter[0], meter[1]);
  const lastStart = notes.length ? notes[notes.length - 1].tick : 0;
  // A note-off on the closing bar line shouldn't add an empty bar, so allow a 1/32 overhang.
  const fromNotes = Math.ceil((lastStart + 1) / bar);
  const fromEnd = Math.ceil(Math.max(0, endOfTrack - PPQ / 8) / bar);
  const bars = Math.max(1, fromNotes, fromEnd);
  return { notes, lengthTicks: bars * bar, meter, bpm: bpm ? Math.round(bpm * 100) / 100 : undefined };
}

export function hitsFromRaw(raw: RawMidi, mapId: string, overrides?: Record<number, string | null>) {
  const map = MAP_BY_ID[mapId] ?? MAP_BY_ID.gm;
  const hits: Hit[] = [];
  const missing = new Map<number, number>();
  for (const n of raw.notes) {
    const art = resolveNote(map, n.note, overrides);
    if (!art) {
      if (!(overrides && n.note in overrides)) missing.set(n.note, (missing.get(n.note) ?? 0) + 1);
      continue;
    }
    hits.push({ id: uid('h'), tick: n.tick, art, vel: n.vel, note: n.note });
  }
  const unmapped = [...missing.entries()].map(([note, count]) => ({ note, count })).sort((a, b) => a.note - b.note);
  return { hits, unmapped };
}

export function patternFromMidi(data: ArrayBuffer, opts: ImportOptions): Pattern {
  const raw = readMidi(data);
  const { hits, unmapped } = hitsFromRaw(raw, opts.mapId, opts.overrides);
  return {
    id: uid('p'),
    name: opts.name,
    lengthTicks: raw.lengthTicks,
    meter: raw.meter,
    bpm: raw.bpm,
    source: opts.source ? { ...opts.source, mapId: opts.mapId } : undefined,
    hits,
    unmapped: unmapped.length ? unmapped : undefined,
  };
}
