/**
 * Turns the song plus a choice of what to export into plans: flat, time-ordered hits with the tempo map, meter
 * and section markers sliced to the exported range and shifted so it starts at tick 0. The MIDI writer and the
 * audio renderer both read plans, so a .mid and a .wav of the same choice line up exactly.
 */
import { compileSong, songEnd } from '../model/compile';
import type { SongEvent } from '../model/compile';
import { ART_BY_ID } from '../model/kit';
import { MAP_BY_ID, noteForArt } from '../model/noteMaps';
import { MeterMap, TempoMap } from '../model/timing';
import { clipEnd } from '../model/types';
import type { MeterPoint, Section, Song, TempoPoint } from '../model/types';

/** A stretch of the song, [from, to) in song ticks. */
export interface Piece {
  from: number;
  to: number;
}

export type Scope = 'song' | 'sections' | 'clips' | 'loop';

export interface Selection {
  scope: Scope;
  /** Ticked sections (Sections scope). */
  sectionIds: string[];
  /** Several ticked sections go into one file, back to back, instead of one file each. */
  joined: boolean;
  /** Selected clips (Selected clip scope). */
  clipIds: string[];
}

/** One file to write. Joined sections have several pieces. */
export interface Job {
  pieces: Piece[];
  /** Only these clips play (selected-clip export). */
  clipIds?: string[];
  /** File-name tokens: section number(s) and name. */
  n: string;
  section: string;
  /** Tempo where the export starts. */
  bpm: number;
  bars: number;
}

/** Note mode that writes each hit's note from its source file. */
export const ORIGINAL_NOTES = 'original';
/** Default note map for export: the plugin's own notes. */
export const NATIVE_MAP_ID = 'kvlt2';

export interface PlanOptions {
  /** Bake the clip feels' random timing and velocity (seeded, so the same export gives the same file). */
  humanize: boolean;
  /** Note map id, or ORIGINAL_NOTES. */
  noteMode: string;
}

export interface PlanEvent {
  /** Ticks from the start of the export, on the grid (humanize timing is in `offsetSec`). */
  tick: number;
  /** Where the hit sits in the song. */
  songTick: number;
  art: string;
  vel: number;
  note: number;
  trackId: string;
  /** Humanize timing offset in seconds (0 when exact). */
  offsetSec: number;
}

export interface Marker {
  tick: number;
  text: string;
}

export interface Plan {
  lengthTicks: number;
  events: PlanEvent[];
  /** Starts at tick 0. Every change inside the range, shifted. */
  tempo: TempoPoint[];
  /** Starts at tick 0. */
  meter: MeterPoint[];
  markers: Marker[];
  /** Articulations the note map has no note for, written as a stand-in it has. */
  substituted: { art: string; as: string }[];
  /** Articulations the note map has no note or stand-in for: left out. */
  droppedArts: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// What to export

export const sectionsInOrder = (song: Song) => [...song.sections].sort((a, b) => a.start - b.start || a.end - b.end);

const pad = (n: number) => String(n).padStart(2, '0');

/** 1-based first and last bar a range touches, for labels like "5–12". */
export function barSpan(meter: MeterMap, from: number, to: number) {
  const first = Math.floor(meter.barAt(from) + 1e-6) + 1;
  const last = Math.max(first, Math.ceil(meter.barAt(to) - 1e-6));
  return { first, last, label: first === last ? `${first}` : `${first}–${last}` };
}

/** Span of the given clips, or null when none of them exist. */
export function clipsSpan(song: Song, clipIds: string[]): Piece | null {
  const clips = song.clips.filter((c) => clipIds.includes(c.id) && song.patterns[c.patternId]);
  if (!clips.length) return null;
  return {
    from: Math.min(...clips.map((c) => c.start)),
    to: Math.max(...clips.map((c) => clipEnd(c, song.patterns[c.patternId]))),
  };
}

/** The files a selection writes, in song order. Empty when the selection has nothing in it. */
export function jobsFor(song: Song, sel: Selection): Job[] {
  const tempo = new TempoMap(song.tempo);
  const meter = new MeterMap(song.meter);
  const ordered = sectionsInOrder(song);
  const num = (s: Section) => pad(ordered.indexOf(s) + 1);
  const job = (pieces: Piece[], n: string, section: string, clipIds?: string[]): Job => ({
    pieces,
    clipIds,
    n,
    section,
    bpm: tempo.bpmAt(pieces[0].from),
    bars: pieces.reduce((sum, p) => sum + meter.barAt(p.to) - meter.barAt(p.from), 0),
  });

  switch (sel.scope) {
    case 'song': {
      const end = songEnd(song);
      return end > 0 ? [job([{ from: 0, to: end }], '', '')] : [];
    }
    case 'sections': {
      const picked = ordered.filter((s) => sel.sectionIds.includes(s.id) && s.end > s.start);
      if (!picked.length) return [];
      if (sel.joined && picked.length > 1) {
        const first = picked[0];
        const last = picked[picked.length - 1];
        const name = picked.length === 2 ? `${first.name} ${last.name}` : `${first.name} to ${last.name}`;
        return [job(picked.map((s) => ({ from: s.start, to: s.end })), `${num(first)}-${num(last)}`, name)];
      }
      return picked.map((s) => job([{ from: s.start, to: s.end }], num(s), s.name));
    }
    case 'clips': {
      const span = clipsSpan(song, sel.clipIds);
      if (!span || span.to <= span.from) return [];
      const clips = song.clips.filter((c) => sel.clipIds.includes(c.id) && song.patterns[c.patternId]);
      const patterns = new Set(clips.map((c) => c.patternId));
      const name = patterns.size === 1 ? song.patterns[clips[0].patternId].name : 'selection';
      return [job([span], '', name, clips.map((c) => c.id))];
    }
    case 'loop': {
      const { start, end, on } = song.loop;
      if (!on || end <= start) return [];
      const same = ordered.find((s) => s.start === start && s.end === end);
      if (same) return [job([{ from: start, to: end }], num(same), same.name)];
      return [job([{ from: start, to: end }], '', `bars ${barSpan(meter, start, end).label}`)];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Slicing

/** Tempo for the pieces laid back to back from tick 0: the tempo at each piece's start, then its changes. */
export function sliceTempo(points: TempoPoint[], pieces: Piece[]): TempoPoint[] {
  const map = new TempoMap(points);
  const out: TempoPoint[] = [];
  const add = (p: TempoPoint) => {
    const last = out[out.length - 1];
    if (last && last.tick === p.tick) out.pop();
    const prev = out[out.length - 1];
    if (!prev || prev.bpm !== p.bpm) out.push(p);
  };
  let offset = 0;
  for (const piece of pieces) {
    add({ tick: offset, bpm: map.bpmAt(piece.from) });
    for (const t of map.points) if (t.tick > piece.from && t.tick < piece.to) add({ tick: t.tick - piece.from + offset, bpm: t.bpm });
    offset += piece.to - piece.from;
  }
  return out.length ? out : [{ tick: 0, bpm: 120 }];
}

/** Time signatures for the pieces laid back to back from tick 0. */
export function sliceMeter(points: MeterPoint[], pieces: Piece[]): MeterPoint[] {
  const map = new MeterMap(points);
  const out: MeterPoint[] = [];
  const add = (p: MeterPoint) => {
    const last = out[out.length - 1];
    if (last && last.tick === p.tick) out.pop();
    const prev = out[out.length - 1];
    if (!prev || prev.num !== p.num || prev.den !== p.den) out.push(p);
  };
  let offset = 0;
  for (const piece of pieces) {
    const m = map.meterAt(piece.from);
    add({ tick: offset, num: m.num, den: m.den });
    for (const p of map.points) if (p.tick > piece.from && p.tick < piece.to) add({ tick: p.tick - piece.from + offset, num: p.num, den: p.den });
    offset += piece.to - piece.from;
  }
  return out.length ? out : [{ tick: 0, num: 4, den: 4 }];
}

/** A marker wherever a section starts inside the pieces, and at a piece's start when it begins mid-section. */
export function sectionMarkers(sections: Section[], pieces: Piece[]): Marker[] {
  const ordered = [...sections].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Marker[] = [];
  let offset = 0;
  for (const piece of pieces) {
    for (const s of ordered) {
      if (s.start >= piece.to || s.end <= piece.from) continue;
      const tick = Math.max(s.start, piece.from) - piece.from + offset;
      if (!out.some((m) => m.tick === tick && m.text === s.name)) out.push({ tick, text: s.name });
    }
    offset += piece.to - piece.from;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Notes

/**
 * Stand-ins for an articulation a note map has no note for, nearest first. Chokes have none: a map without them
 * (General MIDI) has nothing that stops a cymbal, so those hits are left out.
 */
const SUBSTITUTES: Record<string, string[]> = {
  hihat_semiopen: ['hihat_wideopen', 'hihat_closed'],
  hihat_wideopen: ['hihat_semiopen', 'hihat_closed'],
  hihat_pedal: ['hihat_closed'],
  china2: ['china1', 'crash2', 'crash1'],
  china1: ['china2', 'crash1'],
  fx1: ['splash1', 'crash2', 'crash1'],
  fx2: ['china1', 'china2', 'crash1'],
  splash1: ['crash2', 'crash1'],
  crash2: ['crash1'],
  ride_crash: ['crash2', 'crash1', 'ride_bow'],
  ride_bell: ['ride_bow'],
  tom5: ['tom4'],
};

/**
 * Picks the note each hit is written as.
 *
 * With a note map: the map's note for the hit's articulation. When the map lists several, the KVLT note wins if
 * the map agrees with it (noteForArt alone takes the lowest, so General MIDI's kick would be 35). When the map has
 * none, the nearest stand-in it does have (`substituted`); failing that the hit is left out (`droppedArts`).
 * Falling back to the KVLT note isn't safe: General MIDI gives 58 and 61 to a vibraslap and a bongo.
 *
 * With ORIGINAL_NOTES: the note the hit had in its source file, else its KVLT note.
 */
export function noteResolver(mode: string) {
  const map = mode === ORIGINAL_NOTES ? null : (MAP_BY_ID[mode] ?? MAP_BY_ID[NATIVE_MAP_ID]);
  const nativeNote = (art: string) => ART_BY_ID[art]?.note;
  const inMap = (art: string) => {
    if (!map) return undefined;
    const nat = nativeNote(art);
    const entry = nat === undefined ? undefined : map.notes[nat];
    return entry && entry.art === art && !entry.status ? nat : noteForArt(map, art);
  };
  const cache = new Map<string, number | undefined>();
  const substituted = new Map<string, string>();
  const droppedArts = new Set<string>();
  const mapped = (art: string) => {
    if (cache.has(art)) return cache.get(art);
    let n = inMap(art);
    if (n === undefined) {
      for (const sub of SUBSTITUTES[art] ?? []) {
        n = inMap(sub);
        if (n !== undefined) {
          substituted.set(art, sub);
          break;
        }
      }
      if (n === undefined) droppedArts.add(art);
    }
    cache.set(art, n);
    return n;
  };

  return {
    note(ev: SongEvent): number | undefined {
      if (map) return mapped(ev.art);
      return ev.note ?? nativeNote(ev.art);
    },
    substituted: () => [...substituted].map(([art, as]) => ({ art, as })),
    droppedArts: () => [...droppedArts],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Humanize

/** FNV-1a. */
export function hash32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampVel = (v: number) => Math.max(1, Math.min(127, v));

/**
 * The clip feel's random timing and velocity for one hit, as the engine applies it on playback (uniform ±amount).
 * Seeded by the hit itself, so a hit gets the same offset whichever range it's exported in.
 */
export function humanizeHit(ev: Pick<SongEvent, 'tick' | 'art' | 'vel' | 'clipId' | 'jitterMs' | 'jitterVel'>) {
  if (!ev.jitterMs && !ev.jitterVel) return { offsetSec: 0, vel: ev.vel };
  const rnd = mulberry32(hash32(`${ev.clipId}:${ev.tick}:${ev.art}`));
  const t = rnd() * 2 - 1;
  const v = rnd() * 2 - 1;
  return {
    offsetSec: (t * ev.jitterMs) / 1000,
    vel: ev.jitterVel ? clampVel(Math.round(ev.vel + v * ev.jitterVel)) : ev.vel,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Plan

export function buildPlan(song: Song, job: Pick<Job, 'pieces' | 'clipIds'>, opts: PlanOptions): Plan {
  const only = job.clipIds ? new Set(job.clipIds) : null;
  const source: Song = only ? { ...song, clips: song.clips.filter((c) => only.has(c.id)) } : song;
  const notes = noteResolver(opts.noteMode);
  const pieces = job.pieces.filter((p) => p.to > p.from);
  const events: PlanEvent[] = [];
  let offset = 0;
  for (const p of pieces) {
    // What you hear is what you get: muted tracks stay out (the demo keeps alternative riffs on a muted track),
    // except for clips picked by hand.
    const compiled = compileSong(source, { from: p.from, to: p.to, ignoreMute: !!only });
    for (const ev of compiled) {
      const note = notes.note(ev);
      if (note === undefined) continue;
      const h = opts.humanize ? humanizeHit(ev) : { offsetSec: 0, vel: ev.vel };
      events.push({
        tick: ev.tick - p.from + offset,
        songTick: ev.tick,
        art: ev.art,
        vel: h.vel,
        note,
        trackId: ev.trackId,
        offsetSec: h.offsetSec,
      });
    }
    offset += p.to - p.from;
  }
  return {
    lengthTicks: offset,
    events,
    tempo: sliceTempo(song.tempo, pieces),
    meter: sliceMeter(song.meter, pieces),
    markers: sectionMarkers(song.sections, pieces),
    substituted: notes.substituted(),
    droppedArts: notes.droppedArts(),
  };
}
