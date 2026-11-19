import { clipEnd, clipHits, DEFAULT_FEEL } from './types';
import type { Clip, Feel, Pattern, Song, Track } from './types';

/** One hit at its place in the song, ready for the scheduler or the exporter. */
export interface SongEvent {
  tick: number;
  art: string;
  vel: number;
  /** The hit's note in its source file, if it came from one. */
  note?: number;
  trackId: string;
  clipId: string;
  /** Humanize amounts from the clip's feel, applied each time the hit plays. */
  jitterMs: number;
  jitterVel: number;
}

const scaleVel = (vel: number, feel: Feel) => {
  if (feel.velMin <= 1 && feel.velMax >= 127) return vel;
  return Math.round(feel.velMin + ((vel - 1) / 126) * (feel.velMax - feel.velMin));
};

/** Which tracks are heard, after mute and solo. */
export function audibleTracks(tracks: Track[]) {
  const soloed = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => (soloed ? t.solo : !t.mute)).map((t) => t.id));
}

export interface CompileOptions {
  /** Ignore mute/solo (exporting hand-picked clips). */
  ignoreMute?: boolean;
  /** Only events with from ≤ tick < to. */
  from?: number;
  to?: number;
  /** Restrict to these tracks. */
  trackIds?: Set<string>;
}

/** Flattens tracks → clips → repeats → hits into one time-ordered list. */
export function compileSong(song: Song, opts: CompileOptions = {}): SongEvent[] {
  const audible = opts.ignoreMute ? new Set(song.tracks.map((t) => t.id)) : audibleTracks(song.tracks);
  const playing = (c: Clip) => audible.has(c.trackId) && (!opts.trackIds || opts.trackIds.has(c.trackId));

  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  const out: SongEvent[] = [];
  for (const c of song.clips) {
    if (!playing(c)) continue;
    const p: Pattern | undefined = song.patterns[c.patternId];
    if (!p || p.lengthTicks <= 0) continue;
    const feel = c.feel ?? DEFAULT_FEEL;
    for (const { tick, hit: h } of clipHits(c, p, from, to)) {
      out.push({
        tick,
        art: h.art,
        vel: scaleVel(h.vel, feel),
        note: h.note,
        trackId: c.trackId,
        clipId: c.id,
        jitterMs: feel.humanizeMs,
        jitterVel: feel.humanizeVel,
      });
    }
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
}

/** Last tick anything happens: the end of the last clip, section or loop. */
export function songEnd(song: Song) {
  let end = 0;
  for (const c of song.clips) end = Math.max(end, clipEnd(c, song.patterns[c.patternId]));
  for (const s of song.sections) end = Math.max(end, s.end);
  return end;
}
