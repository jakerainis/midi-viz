/** Ticks per quarter note for everything inside the app. Imported files are rescaled to this. */
export const PPQ = 960;

/** One drum hit inside a pattern. `tick` counts from the pattern start. */
export interface Hit {
  id: string;
  tick: number;
  /** Articulation id from model/kit.ts. */
  art: string;
  /** 1–127. */
  vel: number;
  /** The note number in the source file, kept for the raw-notes view and re-mapping. */
  note?: number;
}

/** Notes in a source file that the note map has no sound for. */
export interface UnmappedNote {
  note: number;
  count: number;
}

/** A riff: the notes a clip plays. Several clips can share one pattern (linked copies). */
export interface Pattern {
  id: string;
  name: string;
  lengthTicks: number;
  meter: [number, number];
  /** Tempo written in the source file. */
  bpm?: number;
  source?: { pack: string; file: string; mapId: string };
  /** True once the notes differ from the source file. */
  edited?: boolean;
  hits: Hit[];
  unmapped?: UnmappedNote[];
}

export interface Track {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
  volumeDb: number;
}

/** How a clip plays its pattern. */
export interface Feel {
  /** The pattern's velocities are squeezed into this range. */
  velMin: number;
  velMax: number;
  /** Random timing offset each time a hit plays, ± milliseconds. */
  humanizeMs: number;
  /** Random velocity offset each time a hit plays, ±. */
  humanizeVel: number;
}

export const DEFAULT_FEEL: Feel = { velMin: 1, velMax: 127, humanizeMs: 0, humanizeVel: 0 };

/**
 * A clip is a window onto a pattern, placed on a track. It plays the pattern's loop region [loopStart, loopEnd)
 * over and over for `length` ticks, starting `offset` ticks into the loop. A clip shorter than its loop is cropped;
 * a longer one repeats. Cropping never deletes notes: drag the edge back and they return.
 */
export interface Clip {
  id: string;
  trackId: string;
  patternId: string;
  /** Song tick where the clip starts. */
  start: number;
  /** Ticks on the timeline. */
  length: number;
  /** The part of the pattern that repeats; usually the whole riff. */
  loopStart: number;
  loopEnd: number;
  /** Where in the loop the clip begins (0 ≤ offset < loop length). Trimming the left edge moves it. */
  offset: number;
  feel?: Feel;
}

export interface Section {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface TempoPoint {
  tick: number;
  bpm: number;
}

/** A time signature that starts at `tick` (always a bar line). */
export interface MeterPoint {
  tick: number;
  num: number;
  den: number;
}

export interface LoopRange {
  start: number;
  end: number;
  on: boolean;
}

export interface Song {
  id: string;
  name: string;
  tempo: TempoPoint[];
  meter: MeterPoint[];
  sections: Section[];
  tracks: Track[];
  clips: Clip[];
  patterns: Record<string, Pattern>;
  loop: LoopRange;
}

let idCounter = 0;
/** Short unique ids; good enough for a single-user, in-memory project. */
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const loopLength = (c: Clip) => Math.max(1, c.loopEnd - c.loopStart);
/** How many times the loop plays (2.5 = two and a half times). */
export const clipCycles = (c: Clip) => c.length / loopLength(c);
// `_pattern` is unused now that clips carry their own length; kept so older call sites read the same.
export const clipEnd = (clip: Clip, _pattern?: Pattern) => clip.start + clip.length;

/** A clip that plays a whole pattern once. */
export const newClip = (trackId: string, pattern: Pattern, start: number, length = pattern.lengthTicks): Clip => ({
  id: uid('c'),
  trackId,
  patternId: pattern.id,
  start,
  length,
  loopStart: 0,
  loopEnd: pattern.lengthTicks,
  offset: 0,
});

/** The pattern tick a clip plays at a song tick (assumes the tick is inside the clip). */
export const patternTickAt = (c: Clip, songTick: number) => c.loopStart + mod(c.offset + songTick - c.start, loopLength(c));

/** Every hit a clip plays, with its song tick, limited to [from, to). */
export function clipHits(c: Clip, p: Pattern, from = -Infinity, to = Infinity) {
  const out: { tick: number; hit: Hit }[] = [];
  const L = loopLength(c);
  const loopHits = p.hits.filter((h) => h.tick >= c.loopStart && h.tick < c.loopEnd && h.tick < p.lengthTicks);
  if (!loopHits.length) return out;
  const lo = Math.max(c.start, from);
  const hi = Math.min(c.start + c.length, to);
  if (hi <= lo) return out;
  const origin = c.start - c.offset;
  for (let base = origin + Math.floor((lo - origin) / L) * L; base < hi; base += L) {
    for (const h of loopHits) {
      const t = base + h.tick - c.loopStart;
      if (t >= lo && t < hi) out.push({ tick: t, hit: h });
    }
  }
  return out;
}

/** Song ticks where the loop wraps inside a clip (drawn as dividers). */
export function clipWraps(c: Clip) {
  const L = loopLength(c);
  const out: number[] = [];
  for (let t = mod(L - c.offset, L) || L; t < c.length; t += L) out.push(c.start + t);
  return out;
}
