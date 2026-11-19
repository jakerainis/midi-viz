import { beforeEach, describe, expect, it } from 'vitest';
import { PPQ, newClip } from '../model/types';
import type { Pattern } from '../model/types';
import { loadSong, newSong, useApp, undo } from './store';
import { joinClips, loopVisiblePart, removeMeterPoint, setClipLength, setMeterAt, splitClip, stepRepeat, trimClipStart } from './songActions';

const BAR = PPQ * 4;
const riff: Pattern = {
  id: 'p',
  name: 'riff',
  lengthTicks: BAR * 4,
  meter: [4, 4],
  hits: [0, 1, 2, 3].map((b) => ({ id: `k${b}`, tick: b * BAR, art: 'kick', vel: 100 })),
};

function setup() {
  const s = newSong();
  const c = newClip(s.tracks[0].id, riff, 0);
  s.patterns[riff.id] = riff;
  s.clips.push(c);
  loadSong(s);
  return c.id;
}
const clip = (id: string) => useApp.getState().song.clips.find((c) => c.id === id)!;

describe('clip edits', () => {
  let id = '';
  beforeEach(() => {
    id = setup();
  });

  it('crops and repeats with the right edge', () => {
    setClipLength(id, BAR * 6);
    expect(clip(id).length).toBe(BAR * 6);
    setClipLength(id, BAR);
    expect(clip(id).length).toBe(BAR);
  });

  it('trims the start without moving the notes', () => {
    trimClipStart(id, BAR * 3);
    expect(clip(id)).toMatchObject({ start: BAR * 3, length: BAR, offset: BAR * 3 });
    undo();
    expect(clip(id)).toMatchObject({ start: 0, length: BAR * 4, offset: 0 });
  });

  it('loops just the cropped part (a fill bar)', () => {
    trimClipStart(id, BAR * 3);
    loopVisiblePart(id);
    expect(clip(id)).toMatchObject({ loopStart: BAR * 3, loopEnd: BAR * 4, offset: 0 });
    stepRepeat(id, 1);
    expect(clip(id).length).toBe(BAR * 2);
  });

  it("doesn't grow a cropped clip on ⇧R", () => {
    setClipLength(id, BAR);
    stepRepeat(id, -1);
    expect(clip(id).length).toBe(BAR);
  });

  it('splits anywhere and joins back', () => {
    splitClip(id, BAR + PPQ);
    const clips = useApp.getState().song.clips;
    expect(clips.map((c) => [c.start, c.length, c.offset])).toEqual([
      [0, BAR + PPQ, 0],
      [BAR + PPQ, BAR * 3 - PPQ, BAR + PPQ],
    ]);
    joinClips(clips.map((c) => c.id));
    expect(useApp.getState().song.clips).toHaveLength(1);
    expect(useApp.getState().song.clips[0].length).toBe(BAR * 4);
  });
});

describe('time signatures', () => {
  beforeEach(() => void setup());

  it('adds, changes and removes a change at a bar', () => {
    setMeterAt(BAR * 2, 3, 4);
    expect(useApp.getState().song.meter).toEqual([
      { tick: 0, num: 4, den: 4 },
      { tick: BAR * 2, num: 3, den: 4 },
    ]);
    setMeterAt(BAR * 2, 7, 8);
    expect(useApp.getState().song.meter[1]).toMatchObject({ num: 7, den: 8 });
    removeMeterPoint(BAR * 2);
    expect(useApp.getState().song.meter).toEqual([{ tick: 0, num: 4, den: 4 }]);
  });

  it('keeps later changes on bar lines when an earlier one changes', () => {
    setMeterAt(BAR * 4, 6, 8);
    setMeterAt(BAR, 3, 4);
    const [, a, b] = useApp.getState().song.meter;
    expect(a).toMatchObject({ tick: BAR, num: 3 });
    // A 3/4 bar is 3 beats; the later change lands on one of its bar lines.
    expect((b.tick - BAR) % (PPQ * 3)).toBe(0);
  });

  it('drops a change that repeats the meter before it', () => {
    setMeterAt(BAR * 2, 4, 4);
    expect(useApp.getState().song.meter).toHaveLength(1);
  });
});
