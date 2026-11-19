/** A small song for the export tests. */
import { PPQ } from '../model/types';
import type { Song } from '../model/types';

export const BAR = PPQ * 4;

/**
 * Bars 1–8: a one-bar beat ×8 on the main track, a one-bar fill in bar 4, and an idea in bar 2 on a muted track.
 * 120 bpm, 180 from bar 5, 90 from bar 7. 4/4, 7/8 from bar 7. Sections Intro (1–2), Verse (3–4), Blast (5–8).
 */
export function testSong(): Song {
  return {
    id: 'song-test',
    name: 'Grind Demo',
    tempo: [
      { tick: 0, bpm: 120 },
      { tick: BAR * 4, bpm: 180 },
      { tick: BAR * 6, bpm: 90 },
    ],
    meter: [
      { tick: 0, num: 4, den: 4 },
      { tick: BAR * 6, num: 7, den: 8 },
    ],
    sections: [
      { id: 's-blast', name: 'Blast', start: BAR * 4, end: BAR * 8, color: '#D9774E' },
      { id: 's-intro', name: 'Intro', start: 0, end: BAR * 2, color: '#6E86B3' },
      { id: 's-verse', name: 'Verse', start: BAR * 2, end: BAR * 4, color: '#4FA39B' },
    ],
    tracks: [
      { id: 't-main', name: 'Main beat', color: '#FF9F43', mute: false, solo: false, volumeDb: 0 },
      { id: 't-fill', name: 'Fills', color: '#C9B458', mute: false, solo: false, volumeDb: -6 },
      { id: 't-ideas', name: 'Ideas', color: '#9A7BD1', mute: true, solo: false, volumeDb: 0 },
    ],
    clips: [
      // The beat stops for the fill in bar 4 (fills sit in a gap in the beat, not on top of it).
      { id: 'c-beat', trackId: 't-main', patternId: 'p-beat', start: 0, length: BAR * 3, loopStart: 0, loopEnd: BAR, offset: 0 },
      { id: 'c-beat2', trackId: 't-main', patternId: 'p-beat', start: BAR * 4, length: BAR * 4, loopStart: 0, loopEnd: BAR, offset: 0 },
      { id: 'c-fill', trackId: 't-fill', patternId: 'p-fill', start: BAR * 3, length: BAR, loopStart: 0, loopEnd: BAR, offset: 0 },
      { id: 'c-idea', trackId: 't-ideas', patternId: 'p-idea', start: BAR, length: BAR, loopStart: 0, loopEnd: BAR, offset: 0 },
    ],
    patterns: {
      'p-beat': {
        id: 'p-beat',
        name: 'OneArmBlast2',
        lengthTicks: BAR,
        meter: [4, 4],
        hits: [
          { id: 'b1', tick: 0, art: 'kick', vel: 100, note: 35 },
          { id: 'b2', tick: PPQ, art: 'snare', vel: 90, note: 40 },
          { id: 'b3', tick: PPQ * 2, art: 'kick', vel: 101, note: 36 },
          { id: 'b4', tick: PPQ * 3, art: 'snare', vel: 91 },
        ],
      },
      'p-fill': {
        id: 'p-fill',
        name: 'Tom fill',
        lengthTicks: BAR,
        meter: [4, 4],
        hits: [
          { id: 'f1', tick: 0, art: 'tom1', vel: 110, note: 48 },
          { id: 'f2', tick: PPQ, art: 'china2', vel: 100, note: 61 },
          { id: 'f3', tick: PPQ * 2, art: 'crash1_choke', vel: 120, note: 50 },
        ],
      },
      'p-idea': {
        id: 'p-idea',
        name: 'Bell idea',
        lengthTicks: BAR,
        meter: [4, 4],
        hits: [
          { id: 'i1', tick: PPQ / 2, art: 'ride_bell', vel: 80, note: 53 },
          { id: 'i2', tick: PPQ * 1.5, art: 'hihat_semiopen', vel: 70, note: 46 },
        ],
      },
    },
    loop: { start: BAR * 2, end: BAR * 4, on: true },
  };
}
