import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { PPQ } from '../model/types';
import { BAR, testSong } from './fixtures';
import { NOTE_TICKS, curveVelocity, midiFromPlan, notesFromPlan } from './midi';
import type { MidiExportOptions } from './midi';
import { NATIVE_MAP_ID, buildPlan } from './plan';
import type { Plan, PlanOptions } from './plan';

const planOpts: PlanOptions = { humanize: false, noteMode: NATIVE_MAP_ID };
const midiOpts: MidiExportOptions = { name: 'Grind Demo', tempoChanges: true, markers: true, velCurve: 1 };

const plain = (events: { tick: number; note: number; vel: number }[], lengthTicks = BAR): Plan => ({
  lengthTicks,
  events: events.map((e) => ({ ...e, songTick: e.tick, art: 'kick', trackId: 't', offsetSec: 0 })),
  tempo: [{ tick: 0, bpm: 120 }],
  meter: [{ tick: 0, num: 4, den: 4 }],
  markers: [],
  substituted: [],
  droppedArts: [],
});

describe('MIDI round trip through @tonejs/midi', () => {
  // Bar 4 (the fill, mid-Verse) to the end: a tempo change to 180 at bar 5, 90 and 7/8 at bar 7.
  const plan = buildPlan(testSong(), { pieces: [{ from: BAR * 3, to: BAR * 8 }] }, planOpts);
  const midi = new Midi(midiFromPlan(plan, midiOpts));

  it('is one drum track on channel 10 at PPQ 960', () => {
    expect(midi.header.ppq).toBe(960);
    expect(midi.header.name).toBe('Grind Demo');
    expect(midi.tracks).toHaveLength(1);
    expect(midi.tracks[0].name).toBe('Drums');
    expect(midi.tracks[0].channel).toBe(9);
    expect(midi.tracks[0].instrument.percussion).toBe(true);
  });

  it('writes the notes, velocities and short durations', () => {
    const notes = midi.tracks[0].notes.map((n) => [n.ticks, n.midi, Math.round(n.velocity * 127), n.durationTicks]);
    expect(notes).toHaveLength(3 + 4 * 4);
    expect(notes.slice(0, 7)).toEqual([
      [0, 48, 110, NOTE_TICKS],
      [PPQ, 61, 100, NOTE_TICKS],
      [PPQ * 2, 50, 120, NOTE_TICKS],
      [BAR, 36, 100, NOTE_TICKS],
      [BAR + PPQ, 38, 90, NOTE_TICKS],
      [BAR + PPQ * 2, 36, 101, NOTE_TICKS],
      [BAR + PPQ * 3, 38, 91, NOTE_TICKS],
    ]);
  });

  it('writes the tempo map sliced at the range start', () => {
    expect(midi.header.tempos.map((t) => [t.ticks, Math.round(t.bpm * 100) / 100])).toEqual([
      [0, 120],
      [BAR, 180],
      [BAR * 3, 90],
    ]);
  });

  it('writes the time signatures', () => {
    expect(midi.header.timeSignatures.map((t) => [t.ticks, t.timeSignature])).toEqual([
      [0, [4, 4]],
      [BAR * 3, [7, 8]],
    ]);
  });

  it('writes section names as markers', () => {
    expect(midi.header.meta.map((m) => [m.type, m.ticks, m.text])).toEqual([
      ['marker', 0, 'Verse'],
      ['marker', BAR, 'Blast'],
    ]);
  });

  it('ends exactly at the end of the range', () => {
    expect(midi.tracks[0].endOfTrackTicks).toBe(BAR * 5);
    const quiet = new Midi(midiFromPlan(plain([{ tick: 0, note: 36, vel: 100 }], BAR * 2), midiOpts));
    expect(quiet.tracks[0].endOfTrackTicks).toBe(BAR * 2);
  });

  it('writes only the starting tempo and meter, and no markers, when those options are off', () => {
    const bare = new Midi(midiFromPlan(plan, { ...midiOpts, tempoChanges: false, markers: false }));
    expect(bare.header.tempos.map((t) => [t.ticks, t.bpm])).toEqual([[0, 120]]);
    expect(bare.header.timeSignatures.map((t) => [t.ticks, t.timeSignature])).toEqual([[0, [4, 4]]]);
    expect(bare.header.meta).toEqual([]);
    expect(bare.tracks[0].notes).toHaveLength(19);
  });
});

describe('MIDI notes', () => {
  it('shortens a note so it ends where the next hit on the same note starts', () => {
    const notes = notesFromPlan(
      plain([
        { tick: 0, note: 36, vel: 100 },
        { tick: 60, note: 36, vel: 100 },
        { tick: 60, note: 38, vel: 100 },
      ]),
    );
    expect(notes.map((n) => [n.tick, n.note, n.dur])).toEqual([
      [0, 36, 60],
      [60, 36, NOTE_TICKS],
      [60, 38, NOTE_TICKS],
    ]);
    // Back-to-back notes survive the trip: the note-off goes before the next note-on.
    const midi = new Midi(midiFromPlan(plain([{ tick: 0, note: 36, vel: 100 }, { tick: 60, note: 36, vel: 100 }]), midiOpts));
    expect(midi.tracks[0].notes.map((n) => [n.ticks, n.durationTicks])).toEqual([
      [0, 60],
      [60, NOTE_TICKS],
    ]);
  });

  it('keeps the louder of two hits on the same note and tick', () => {
    const notes = notesFromPlan(plain([{ tick: 0, note: 36, vel: 80 }, { tick: 0, note: 36, vel: 110 }]));
    expect(notes.map((n) => n.vel)).toEqual([110]);
  });

  it('clips the last note to the end of the range', () => {
    const notes = notesFromPlan(plain([{ tick: BAR - 30, note: 36, vel: 100 }]));
    expect(notes[0].dur).toBe(30);
  });

  it('bakes humanize timing into ticks through the tempo', () => {
    const p = plain([{ tick: PPQ, note: 36, vel: 100 }]);
    p.events[0].offsetSec = 0.01; // 10 ms at 120 bpm = 19.2 ticks
    expect(notesFromPlan(p)[0].tick).toBe(PPQ + 19);
    p.events[0].offsetSec = -1;
    expect(notesFromPlan(p)[0].tick).toBe(0);
  });

  it('bakes the velocity curve', () => {
    expect(curveVelocity(64, 1)).toBe(64);
    expect(curveVelocity(64, 0.5)).toBe(90);
    expect(curveVelocity(127, 2)).toBe(127);
    expect(curveVelocity(1, 2)).toBe(1);
  });
});
