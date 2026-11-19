import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MeterMap, TempoMap } from './timing';
import { compileSong, songEnd } from './compile';
import { parseRiffName } from './library';
import { hitsFromRaw, meterFromName, readMidi } from './importMidi';
import { MAP_BY_ID, defaultMapForPack, resolveNote } from './noteMaps';
import { PPQ } from './types';
import type { Song } from './types';
import { clipHits, clipWraps, patternTickAt } from './types';
import { migrateSong } from './migrate';

const BAR = PPQ * 4;

describe('TempoMap', () => {
  const t = new TempoMap([
    { tick: 0, bpm: 120 },
    { tick: BAR * 2, bpm: 240 },
  ]);
  it('converts ticks to seconds across a tempo change', () => {
    expect(t.seconds(BAR)).toBeCloseTo(2); // 4 beats at 120
    expect(t.seconds(BAR * 2)).toBeCloseTo(4);
    expect(t.seconds(BAR * 3)).toBeCloseTo(5); // 4 beats at 240
  });
  it('round-trips seconds to ticks', () => {
    for (const tick of [0, 123, BAR, BAR * 2 + 77, BAR * 5]) expect(t.tick(t.seconds(tick))).toBeCloseTo(tick, 6);
  });
  it('adds a start point when the first change is late', () => {
    expect(new TempoMap([{ tick: BAR, bpm: 90 }]).bpmAt(0)).toBe(90);
  });
});

describe('MeterMap', () => {
  const m = new MeterMap([
    { tick: 0, num: 4, den: 4 },
    { tick: BAR * 2, num: 7, den: 8 },
  ]);
  const sevenEight = (7 * PPQ) / 2;
  it('finds bars across a meter change', () => {
    expect(m.tickOfBar(2)).toBe(BAR * 2);
    expect(m.tickOfBar(3)).toBe(BAR * 2 + sevenEight);
    expect(m.barAt(BAR * 2 + sevenEight)).toBeCloseTo(3);
  });
  it('formats bar.beat.sixteenth', () => {
    expect(m.bbt(0)).toEqual({ bar: 1, beat: 1, sixteenth: 1 });
    expect(m.bbt(BAR + PPQ * 2 + PPQ / 4)).toEqual({ bar: 2, beat: 3, sixteenth: 2 });
    expect(m.bbt(BAR * 2 + PPQ / 2)).toEqual({ bar: 3, beat: 2, sixteenth: 1 });
  });
  it('snaps to bars and beats', () => {
    expect(m.snapBar(BAR * 0.6)).toBe(BAR);
    expect(m.snapBar(BAR * 0.6, 'floor')).toBe(0);
    expect(m.snapBeat(PPQ * 1.4)).toBe(PPQ);
  });
});

const song = (): Song => ({
  id: 's',
  name: 't',
  tempo: [{ tick: 0, bpm: 120 }],
  meter: [{ tick: 0, num: 4, den: 4 }],
  sections: [],
  tracks: [
    { id: 'main', name: 'Main', color: '', mute: false, solo: false, volumeDb: 0 },
    { id: 'fill', name: 'Fill', color: '', mute: false, solo: false, volumeDb: 0 },
  ],
  patterns: {
    beat: { id: 'beat', name: 'beat', lengthTicks: BAR, meter: [4, 4], hits: [0, 1, 2, 3].map((b) => ({ id: `k${b}`, tick: b * PPQ, art: 'kick', vel: 100 })) },
    fill: { id: 'fill', name: 'fill', lengthTicks: BAR, meter: [4, 4], hits: [{ id: 'f', tick: 0, art: 'tom1', vel: 90 }] },
  },
  clips: [
    { id: 'c1', trackId: 'main', patternId: 'beat', start: 0, length: BAR * 4, loopStart: 0, loopEnd: BAR, offset: 0 },
    { id: 'c2', trackId: 'fill', patternId: 'fill', start: BAR * 3, length: BAR, loopStart: 0, loopEnd: BAR, offset: 0 },
  ],
  loop: { start: 0, end: BAR, on: false },
});

describe('compileSong', () => {
  it('writes out repeats', () => {
    const ev = compileSong(song()).filter((e) => e.art === 'kick');
    expect(ev).toHaveLength(16);
    expect(ev[15].tick).toBe(BAR * 3 + PPQ * 3);
  });
  it('honours mute and solo', () => {
    const s = song();
    s.tracks[1].solo = true;
    expect(compileSong(s).every((e) => e.trackId === 'fill')).toBe(true);
    s.tracks[1].solo = false;
    s.tracks[0].mute = true;
    expect(compileSong(s).every((e) => e.trackId === 'fill')).toBe(true);
  });
  it('limits to a range', () => {
    const ev = compileSong(song(), { from: BAR, to: BAR * 2 });
    expect(ev).toHaveLength(4);
    expect(songEnd(song())).toBe(BAR * 4);
  });
  it('squeezes velocities into the clip feel range', () => {
    const s = song();
    s.clips[0].feel = { velMin: 60, velMax: 80, humanizeMs: 0, humanizeVel: 0 };
    const v = compileSong(s).filter((e) => e.art === 'kick')[0].vel;
    expect(v).toBeGreaterThanOrEqual(60);
    expect(v).toBeLessThanOrEqual(80);
  });
});

describe('clip windows', () => {
  // A 4-beat riff: kick on every beat, the fill (tom) on beat 4.
  const p = {
    id: 'p',
    name: 'p',
    lengthTicks: BAR,
    meter: [4, 4] as [number, number],
    hits: [0, 1, 2].map((b) => ({ id: `k${b}`, tick: b * PPQ, art: 'kick', vel: 100 })).concat([{ id: 't', tick: 3 * PPQ, art: 'tom1', vel: 90 }]),
  };
  const base = { id: 'c', trackId: 't', patternId: 'p', loopStart: 0, loopEnd: BAR, offset: 0 };
  it('crops to part of a riff without losing the rest', () => {
    // Just the fill beat, placed at bar 3.
    const c = { ...base, start: BAR * 2, length: PPQ, offset: PPQ * 3 };
    expect(clipHits(c, p).map((x) => [x.tick, x.hit.art])).toEqual([[BAR * 2, 'tom1']]);
  });
  it('repeats past the end, including part of a pass', () => {
    const c = { ...base, start: 0, length: BAR + PPQ * 2 };
    expect(clipHits(c, p).map((x) => x.tick)).toEqual([0, PPQ, PPQ * 2, PPQ * 3, BAR, BAR + PPQ]);
    expect(clipWraps(c)).toEqual([BAR]);
  });
  it('loops a sub-range', () => {
    const c = { ...base, start: 0, length: PPQ * 3, loopStart: PPQ * 2, loopEnd: PPQ * 3 };
    expect(clipHits(c, p).map((x) => x.hit.id)).toEqual(['k2', 'k2', 'k2']);
  });
  it('maps song ticks back into the riff', () => {
    const c = { ...base, start: BAR, length: BAR * 2, offset: PPQ };
    expect(patternTickAt(c, BAR)).toBe(PPQ);
    expect(patternTickAt(c, BAR + PPQ * 3)).toBe(0);
  });
  it('migrates clips saved with repeats', () => {
    const old = song() as unknown as { clips: Record<string, unknown>[] };
    old.clips = [{ id: 'c', trackId: 'main', patternId: 'beat', start: 0, repeats: 3 }];
    const m = migrateSong(old as unknown as Song);
    expect(m.clips[0]).toMatchObject({ length: BAR * 3, loopStart: 0, loopEnd: BAR, offset: 0 });
  });
});

describe('riff names', () => {
  it('reads tempo, family and index', () => {
    expect(parseRiffName('Grindcore', '200bpmOneArmBlast2.mid')).toMatchObject({ bpm: 200, family: 'OneArmBlast', index: 2, name: 'OneArmBlast2', isFill: false });
    expect(parseRiffName('Grindcore', 'Fill7.mid')).toMatchObject({ family: 'Fills', isFill: true });
    expect(parseRiffName('Black Metal', '12.mid')).toMatchObject({ family: 'Fills', name: 'Fill 12' });
  });
});

describe('note maps', () => {
  it('gives packs that use note 24 the classic map', () => {
    expect(defaultMapForPack('NWOBHM')).toBe('ugritone-classic');
    expect(defaultMapForPack('Progressive Death Metal ')).toBe('prog-death');
    expect(defaultMapForPack('Death Metal')).toBe('ugritone');
  });
  it('fixes the notes v1 got wrong', () => {
    const classic = MAP_BY_ID['ugritone-classic'];
    expect(resolveNote(classic, 24)).toBe('hihat_semiopen');
    expect(resolveNote(classic, 50)).toBe('crash1_choke');
    expect(resolveNote(classic, 46)).toBe('hihat_wideopen');
    expect(resolveNote(MAP_BY_ID.ugritone, 46)).toBe('hihat_semiopen');
  });
  it('lets overrides silence or move a note', () => {
    expect(resolveNote(MAP_BY_ID.ugritone, 36, { 36: null })).toBeUndefined();
    expect(resolveNote(MAP_BY_ID.ugritone, 36, { 36: 'snare' })).toBe('snare');
  });
});

describe('meterFromName', () => {
  it('reads meters written in riff names', () => {
    expect(meterFromName('187bpm3-4BombBlast1.mid')).toEqual([3, 4]);
    expect(meterFromName('13-4-ProggyBeat2')).toEqual([13, 4]);
    expect(meterFromName('7-8 Groove.mid')).toEqual([7, 8]);
    expect(meterFromName('Fill3-4_1')).toEqual([3, 4]);
    expect(meterFromName('200bpmOneArmBlast2')).toBeUndefined();
    expect(meterFromName('132bpmGroove5-2.mid')).toBeUndefined();
    expect(meterFromName('165bpmDBeat2-8.mid')).toBeUndefined();
  });
});

describe('readMidi', () => {
  const file = (p: string) => {
    const b = readFileSync(new URL(`../../public/midi/${p}`, import.meta.url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  it('reads a library riff into whole bars at app PPQ', () => {
    const raw = readMidi(file('Grindcore/200bpmOneArmBlast2.mid'));
    expect(raw.lengthTicks % BAR).toBe(0);
    // Ugritone files carry no tempo event; the tempo comes from the file name.
    expect(raw.bpm === undefined || raw.bpm === 200).toBe(true);
    expect(raw.notes.length).toBeGreaterThan(10);
    const { unmapped } = hitsFromRaw(raw, 'ugritone-classic');
    expect(unmapped).toEqual([]);
  });
});
