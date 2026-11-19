/** Brings saved songs up to the current shape. */
import type { Clip, Song } from './types';

type OldClip = Partial<Clip> & { id: string; trackId: string; patternId: string; start: number; repeats?: number };

/** Clips from before cropping stored `repeats`; they become a length over the whole riff. */
export function migrateSong(song: Song): Song {
  const clips = (song.clips as OldClip[]).map((c): Clip => {
    if (typeof c.length === 'number' && typeof c.loopEnd === 'number') return c as Clip;
    const len = song.patterns[c.patternId]?.lengthTicks ?? 3840;
    const { repeats, ...rest } = c;
    return { ...rest, length: len * Math.max(1, repeats ?? 1), loopStart: 0, loopEnd: len, offset: 0 } as Clip;
  });
  // Track roles (main / fill) are gone; fills now go on the same track as the beat.
  const tracks = song.tracks.map((t) => {
    const { role: _role, ...rest } = t as typeof t & { role?: string };
    return rest;
  });
  return { ...song, tracks, clips };
}
