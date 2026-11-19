import { describe, expect, it } from 'vitest';
import { PPQ } from '../model/types';
import { BAR, testSong } from './fixtures';
import { NATIVE_MAP_ID, ORIGINAL_NOTES, buildPlan, jobsFor, sectionMarkers, sliceMeter, sliceTempo } from './plan';
import type { Plan, PlanOptions, Selection } from './plan';

const opts: PlanOptions = { humanize: false, noteMode: NATIVE_MAP_ID };
const brief = (p: Plan) => p.events.map((e) => [e.tick, e.art]);

describe('range slicing', () => {
  it('keeps the hits inside the range and shifts them to tick 0', () => {
    const plan = buildPlan(testSong(), { pieces: [{ from: BAR * 2, to: BAR * 4 }] }, opts);
    expect(plan.lengthTicks).toBe(BAR * 2);
    expect(brief(plan)).toEqual([
      [0, 'kick'],
      [PPQ, 'snare'],
      [PPQ * 2, 'kick'],
      [PPQ * 3, 'snare'],
      [BAR, 'tom1'],
      [BAR + PPQ, 'china2'],
      [BAR + PPQ * 2, 'crash1_choke'],
    ]);
    expect(plan.events[0].songTick).toBe(BAR * 2);
  });

  it('lays joined pieces back to back', () => {
    const plan = buildPlan(testSong(), { pieces: [{ from: 0, to: BAR }, { from: BAR * 5, to: BAR * 6 }] }, opts);
    expect(plan.lengthTicks).toBe(BAR * 2);
    expect(plan.events.map((e) => e.tick)).toEqual([0, PPQ, PPQ * 2, PPQ * 3, BAR, BAR + PPQ, BAR + PPQ * 2, BAR + PPQ * 3]);
    expect(plan.events[4].songTick).toBe(BAR * 5);
  });

  it('leaves muted tracks out, and follows solo', () => {
    const song = testSong();
    const bar2 = { pieces: [{ from: BAR, to: BAR * 2 }] };
    expect(buildPlan(song, bar2, opts).events.map((e) => e.art)).toEqual(['kick', 'snare', 'kick', 'snare']);
    song.tracks[1].solo = true;
    expect(buildPlan(song, { pieces: [{ from: 0, to: BAR * 8 }] }, opts).events.map((e) => e.art)).toEqual(['tom1', 'china2', 'crash1_choke']);
  });

  it('writes a clip picked by hand even on a muted track', () => {
    const plan = buildPlan(testSong(), { pieces: [{ from: BAR, to: BAR * 2 }], clipIds: ['c-idea'] }, opts);
    expect(brief(plan)).toEqual([
      [PPQ / 2, 'ride_bell'],
      [PPQ * 1.5, 'hihat_semiopen'],
    ]);
  });

  it('plays only the selected clips', () => {
    // Bar 5: the beat clip only, without the fill or the muted idea.
    const plan = buildPlan(testSong(), { pieces: [{ from: BAR * 4, to: BAR * 5 }], clipIds: ['c-beat2'] }, opts);
    expect(brief(plan)).toEqual([
      [0, 'kick'],
      [PPQ, 'snare'],
      [PPQ * 2, 'kick'],
      [PPQ * 3, 'snare'],
    ]);
  });
});

describe('tempo and meter slicing', () => {
  const song = testSong();

  it('starts with the tempo in force at the range start and shifts later changes', () => {
    expect(sliceTempo(song.tempo, [{ from: BAR * 3, to: BAR * 8 }])).toEqual([
      { tick: 0, bpm: 120 },
      { tick: BAR, bpm: 180 },
      { tick: BAR * 3, bpm: 90 },
    ]);
    expect(sliceTempo(song.tempo, [{ from: BAR * 5, to: BAR * 6 }])).toEqual([{ tick: 0, bpm: 180 }]);
  });

  it('takes a change on the range start as the first tempo and drops changes at or after the end', () => {
    expect(sliceTempo(song.tempo, [{ from: BAR * 4, to: BAR * 7 }])).toEqual([
      { tick: 0, bpm: 180 },
      { tick: BAR * 2, bpm: 90 },
    ]);
    expect(sliceTempo(song.tempo, [{ from: 0, to: BAR * 4 }])).toEqual([{ tick: 0, bpm: 120 }]);
  });

  it('stitches joined pieces and merges repeats of the same tempo', () => {
    const pieces = [
      { from: 0, to: BAR },
      { from: BAR * 2, to: BAR * 3 },
      { from: BAR * 5, to: BAR * 7 },
    ];
    expect(sliceTempo(song.tempo, pieces)).toEqual([
      { tick: 0, bpm: 120 },
      { tick: BAR * 2, bpm: 180 },
      { tick: BAR * 3, bpm: 90 },
    ]);
  });

  it('slices the time signatures the same way', () => {
    expect(sliceMeter(song.meter, [{ from: BAR * 5, to: BAR * 8 }])).toEqual([
      { tick: 0, num: 4, den: 4 },
      { tick: BAR, num: 7, den: 8 },
    ]);
    expect(sliceMeter(song.meter, [{ from: BAR * 6, to: BAR * 8 }])).toEqual([{ tick: 0, num: 7, den: 8 }]);
  });

  it('marks section starts, and the range start when it begins mid-section', () => {
    expect(sectionMarkers(song.sections, [{ from: BAR, to: BAR * 5 }])).toEqual([
      { tick: 0, text: 'Intro' },
      { tick: BAR, text: 'Verse' },
      { tick: BAR * 3, text: 'Blast' },
    ]);
  });
});

describe('what to export', () => {
  const song = testSong();
  const sel: Selection = { scope: 'sections', sectionIds: ['s-blast', 's-verse'], joined: false, clipIds: [] };

  it('writes one file per section, in song order, numbered by place in the song', () => {
    const jobs = jobsFor(song, sel);
    expect(jobs.map((j) => [j.n, j.section, j.bpm])).toEqual([
      ['02', 'Verse', 120],
      ['03', 'Blast', 180],
    ]);
    expect(jobs[0].bars).toBe(2);
  });

  it('joins sections into one file', () => {
    const jobs = jobsFor(song, { ...sel, joined: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].pieces).toEqual([
      { from: BAR * 2, to: BAR * 4 },
      { from: BAR * 4, to: BAR * 8 },
    ]);
    expect([jobs[0].n, jobs[0].section]).toEqual(['02-03', 'Verse Blast']);
  });

  it('covers the whole song, the loop and the selected clip', () => {
    expect(jobsFor(song, { ...sel, scope: 'song' })[0].pieces).toEqual([{ from: 0, to: BAR * 8 }]);
    expect(jobsFor(song, { ...sel, scope: 'loop' })[0].section).toBe('Verse');
    const [clip] = jobsFor(song, { ...sel, scope: 'clips', clipIds: ['c-fill'] });
    expect([clip.pieces, clip.section, clip.clipIds]).toEqual([[{ from: BAR * 3, to: BAR * 4 }], 'Tom fill', ['c-fill']]);
  });

  it('has nothing to write when the choice is empty', () => {
    expect(jobsFor(song, { ...sel, scope: 'clips' })).toEqual([]);
    expect(jobsFor(song, { ...sel, sectionIds: [] })).toEqual([]);
    expect(jobsFor({ ...song, loop: { ...song.loop, on: false } }, { ...sel, scope: 'loop' })).toEqual([]);
  });
});

describe('note mapping', () => {
  const song = testSong();
  const bar4 = { pieces: [{ from: BAR * 3, to: BAR * 4 }] };
  const notes = (p: Plan) => Object.fromEntries(p.events.map((e) => [e.art, e.note]));

  // Bars 4–5: the fill, then the beat.
  const bars45 = { pieces: [{ from: BAR * 3, to: BAR * 5 }] };

  it('writes KVLT Drums II native notes by default', () => {
    const plan = buildPlan(song, bars45, opts);
    expect(notes(plan)).toEqual({ kick: 36, snare: 38, tom1: 48, china2: 61, crash1_choke: 50 });
    expect([plan.substituted, plan.droppedArts]).toEqual([[], []]);
  });

  it('maps to General MIDI, preferring the KVLT note where the map agrees', () => {
    const plan = buildPlan(song, bars45, { ...opts, noteMode: 'gm' });
    // GM lists kick on 35 and 36; 36 is the KVLT note. China 2 has no GM note, so it becomes China 1. Nothing in
    // GM stands in for a crash choke, so that hit is left out.
    expect(notes(plan)).toEqual({ kick: 36, snare: 38, tom1: 48, china2: 52 });
    expect(plan.substituted).toEqual([{ art: 'china2', as: 'china1' }]);
    expect(plan.droppedArts).toEqual(['crash1_choke']);
    const idea = buildPlan(song, { pieces: [{ from: BAR, to: BAR * 2 }], clipIds: ['c-idea'] }, { ...opts, noteMode: 'gm' });
    expect(notes(idea)).toEqual({ ride_bell: 53, hihat_semiopen: 46 });
  });

  it("writes each riff's original notes, falling back to KVLT", () => {
    const plan = buildPlan(song, { pieces: [{ from: 0, to: BAR }] }, { ...opts, noteMode: ORIGINAL_NOTES });
    expect(plan.events.map((e) => e.note)).toEqual([35, 40, 36, 38]);
    const fill = buildPlan(song, bar4, { ...opts, noteMode: ORIGINAL_NOTES });
    expect(fill.events.map((e) => e.note)).toEqual([48, 61, 50]);
  });
});

describe('humanize', () => {
  const song = testSong();
  song.clips[0].feel = { velMin: 1, velMax: 127, humanizeMs: 10, humanizeVel: 8 };
  const bars12 = { pieces: [{ from: 0, to: BAR * 2 }] };

  it('is exact when off', () => {
    const plan = buildPlan(song, bars12, opts);
    expect(plan.events.every((e) => e.offsetSec === 0)).toBe(true);
    expect(plan.events.map((e) => e.vel)).toEqual([100, 90, 101, 91, 100, 90, 101, 91]);
  });

  it('stays inside the feel and gives a hit the same jitter in every export', () => {
    const a = buildPlan(song, bars12, { ...opts, humanize: true });
    expect(buildPlan(song, bars12, { ...opts, humanize: true }).events).toEqual(a.events);
    const bar2 = buildPlan(song, { pieces: [{ from: BAR, to: BAR * 2 }] }, { ...opts, humanize: true });
    expect(bar2.events.map((e) => [e.offsetSec, e.vel])).toEqual(a.events.slice(4).map((e) => [e.offsetSec, e.vel]));
    expect(a.events.some((e) => e.offsetSec !== 0)).toBe(true);
    const base = [100, 90, 101, 91, 100, 90, 101, 91];
    a.events.forEach((e, i) => {
      expect(Math.abs(e.offsetSec)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(e.vel - base[i])).toBeLessThanOrEqual(8);
    });
  });
});
