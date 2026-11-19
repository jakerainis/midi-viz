/** Edits to the arrangement. Each one is a single undo step unless noted. */
import { clipEnd, loopLength, mod, newClip, PPQ, uid } from '../model/types';
import type { Clip, Pattern, Section, Song, Track } from '../model/types';
import { MeterMap } from '../model/timing';
import { songEnd } from '../model/compile';
import { edit, setArrange, useApp } from './store';
import { patternForRiff } from './riffs';

const CLIP_COLORS = ['#3B4F72', '#2E5E5A', '#7A3A26', '#573F7A', '#5E5326', '#6B3550', '#2F5A3A', '#5A4A2E', '#3E5A6E', '#6A4A2A'];
export const SECTION_COLORS = ['#6E86B3', '#4FA39B', '#D9774E', '#9A7BD1', '#C9B458', '#D16A8A', '#5FA35F'];
const TRACK_COLORS = ['#FF9F43', '#C9B458', '#7C8390', '#5BA8FF', '#D9A3FF', '#4FD1A5'];

/** Stable colour per riff family so copies of a groove read as the same groove. */
export function colorForPattern(p: Pattern | undefined) {
  const key = (p?.name ?? '').replace(/[\s_-]*\d+$/, '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLIP_COLORS[h % CLIP_COLORS.length];
}

const meterOf = (song: Song) => new MeterMap(song.meter);

/** How many times a pattern is used, i.e. whether a clip is a linked copy. */
export function patternUses(song: Song, patternId: string) {
  return song.clips.reduce((n, c) => n + (c.patternId === patternId ? 1 : 0), 0);
}

/** An empty song takes the tempo of the first riff dropped into it. */
function adoptTempo(s: Song, bpm: number | undefined) {
  if (bpm && s.clips.length === 0 && s.tempo.length === 1) s.tempo[0].bpm = bpm;
}

/** Loads a library riff and drops it on a track at a tick. Returns the new clip id. */
export async function insertRiff(key: string, trackId: string, start: number) {
  const pattern = await patternForRiff(key);
  const clip = newClip(trackId, pattern, start);
  edit((s) => {
    adoptTempo(s, pattern.bpm);
    s.patterns[pattern.id] = pattern;
    s.clips.push(clip);
  });
  useApp.setState({ selectedClipIds: [clip.id], selectedTrackId: trackId, editClipId: clip.id, selectedHitIds: [] });
  return clip.id;
}

/** Places an existing pattern as a new (linked) clip. */
export function insertPattern(patternId: string, trackId: string, start: number) {
  const p = useApp.getState().song.patterns[patternId];
  if (!p) return;
  const clip = newClip(trackId, p, start);
  edit((s) => {
    s.clips.push(clip);
  });
  useApp.setState({ selectedClipIds: [clip.id], editClipId: clip.id, selectedHitIds: [] });
}

let newCount = 0;

/** A new empty riff, drawn from scratch. `length` is rounded up to whole bars. */
export function newEmptyClip(trackId: string, start: number, length?: number) {
  const { song } = useApp.getState();
  const m = meterOf(song);
  const at = m.meterAt(start);
  const bar = m.barLength(start);
  const len = Math.max(bar, Math.ceil((length ?? bar) / bar - 1e-6) * bar);
  newCount += 1;
  const pattern: Pattern = { id: uid('p'), name: `New riff ${newCount}`, lengthTicks: len, meter: [at.num, at.den], hits: [], edited: true };
  const clip = newClip(trackId, pattern, start);
  edit((s) => {
    s.patterns[pattern.id] = pattern;
    s.clips.push(clip);
  });
  useApp.setState({ selectedClipIds: [clip.id], selectedTrackId: trackId, editClipId: clip.id, selectedHitIds: [], focus: 'editor' });
  setArrange({ showDock: true });
  return clip.id;
}

/** Replaces the pattern of a clip with a library riff, keeping its position and length. */
export async function replaceClipRiff(clipId: string, key: string) {
  const pattern = await patternForRiff(key);
  edit((s) => {
    const c = s.clips.find((x) => x.id === clipId);
    if (!c) return;
    s.patterns[pattern.id] = pattern;
    c.patternId = pattern.id;
    c.loopStart = 0;
    c.loopEnd = pattern.lengthTicks;
    c.offset = 0;
    gcPatterns(s);
  });
}

export function addTrack(name?: string) {
  const id = uid('t');
  edit((s) => {
    const n = s.tracks.length;
    s.tracks.push({
      id,
      name: name ?? `Track ${n + 1}`,
      color: TRACK_COLORS[n % TRACK_COLORS.length],
      mute: false,
      solo: false,
      volumeDb: 0,
    });
  });
  useApp.setState({ selectedTrackId: id });
  return id;
}

export function updateTrack(id: string, patch: Partial<Track>, history = true) {
  edit(
    (s) => {
      const t = s.tracks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    },
    { history },
  );
}

export function removeTrack(id: string) {
  edit((s) => {
    s.tracks = s.tracks.filter((t) => t.id !== id);
    s.clips = s.clips.filter((c) => c.trackId !== id);
    gcPatterns(s);
  });
}

export function updateClip(id: string, patch: Partial<Clip>, history = true) {
  edit(
    (s) => {
      const c = s.clips.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    { history },
  );
}

export function moveClips(moves: { id: string; start: number; trackId?: string }[], history = true) {
  edit(
    (s) => {
      for (const m of moves) {
        const c = s.clips.find((x) => x.id === m.id);
        if (!c) continue;
        c.start = Math.max(0, Math.round(m.start));
        if (m.trackId) c.trackId = m.trackId;
      }
    },
    { history },
  );
}

export function deleteClips(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  edit((s) => {
    s.clips = s.clips.filter((c) => !set.has(c.id));
    gcPatterns(s);
  });
  useApp.setState((st) => ({
    selectedClipIds: st.selectedClipIds.filter((x) => !set.has(x)),
    editClipId: st.editClipId && set.has(st.editClipId) ? null : st.editClipId,
  }));
}

/** Copies clips right after themselves. `linked` shares the pattern; otherwise each copy gets its own. */
export function duplicateClips(ids: string[], linked: boolean) {
  const { song } = useApp.getState();
  const clips = song.clips.filter((c) => ids.includes(c.id));
  if (!clips.length) return;
  const first = Math.min(...clips.map((c) => c.start));
  const last = Math.max(...clips.map((c) => clipEnd(c, song.patterns[c.patternId])));
  const shift = last - first;
  const newIds: string[] = [];
  edit((s) => {
    for (const c of clips) {
      let patternId = c.patternId;
      if (!linked) {
        const p = song.patterns[c.patternId];
        patternId = uid('p');
        s.patterns[patternId] = { ...structuredClone(p), id: patternId };
      }
      const id = uid('c');
      newIds.push(id);
      s.clips.push({ ...structuredClone(c), id, patternId, start: c.start + shift });
    }
  });
  useApp.setState({ selectedClipIds: newIds, editClipId: newIds[0] ?? null });
}

/** Gives a linked clip its own copy of the pattern. */
export function makeUnique(id: string) {
  const { song } = useApp.getState();
  const orig = song.clips.find((x) => x.id === id);
  const p = orig && song.patterns[orig.patternId];
  if (!orig || !p) return;
  edit((s) => {
    const c = s.clips.find((x) => x.id === id)!;
    const pid = uid('p');
    s.patterns[pid] = { ...structuredClone(p), id: pid };
    c.patternId = pid;
  });
}

/** Sets a clip's length on the timeline: shorter crops it, longer repeats its loop. */
export function setClipLength(id: string, length: number, history = true) {
  updateClip(id, { length: Math.max(PPQ / 4, Math.round(length)) }, history);
}

/** Adds or removes one pass of the loop (R / ⇧R). */
export function stepRepeat(id: string, dir: 1 | -1) {
  const c = useApp.getState().song.clips.find((x) => x.id === id);
  if (!c) return;
  const L = loopLength(c);
  const passes = c.length / L;
  // A partial pass first snaps to the nearest whole one in that direction.
  if (dir < 0 && passes <= 1 + 1e-6) return;
  const whole = Math.abs(passes - Math.round(passes)) < 1e-6;
  const next = whole ? Math.round(passes) + dir : dir > 0 ? Math.ceil(passes) : Math.floor(passes);
  setClipLength(id, Math.max(1, next) * L);
}

/** Moves a clip's left edge, keeping the notes where they are (crops or reveals the start). */
export function trimClipStart(id: string, newStart: number, history = true) {
  edit(
    (s) => {
      const c = s.clips.find((x) => x.id === id);
      if (!c) return;
      const end = c.start + c.length;
      const start = Math.max(0, Math.min(Math.round(newStart), end - PPQ / 4));
      const d = start - c.start;
      c.offset = mod(c.offset + d, loopLength(c));
      c.length -= d;
      c.start = start;
    },
    { history },
  );
}

/** Splits a clip in two at a song tick. Both halves keep playing exactly what they played before. */
export function splitClip(id: string, tick: number) {
  const { song } = useApp.getState();
  const c = song.clips.find((x) => x.id === id);
  if (!c) return;
  const at = Math.round(tick - c.start);
  if (at <= 0 || at >= c.length) return;
  const rightId = uid('c');
  edit((s) => {
    const left = s.clips.find((x) => x.id === id)!;
    left.length = at;
    s.clips.push({ ...structuredClone(c), id: rightId, start: c.start + at, length: c.length - at, offset: mod(c.offset + at, loopLength(c)) });
  });
  useApp.setState({ selectedClipIds: [rightId], editClipId: rightId });
}

/** Joins touching clips that continue the same loop of the same riff into one. */
export function joinClips(ids: string[]) {
  const { song } = useApp.getState();
  const clips = song.clips.filter((c) => ids.includes(c.id)).sort((a, b) => a.start - b.start);
  if (clips.length < 2) return;
  const first = clips[0];
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1];
    const b = clips[i];
    const continues =
      b.patternId === a.patternId &&
      b.trackId === a.trackId &&
      b.loopStart === a.loopStart &&
      b.loopEnd === a.loopEnd &&
      b.start === a.start + a.length &&
      b.offset === mod(a.offset + a.length, loopLength(a));
    if (!continues) return;
  }
  edit((s) => {
    const keep = s.clips.find((c) => c.id === first.id)!;
    keep.length = clips.reduce((n, c) => n + c.length, 0);
    const drop = new Set(clips.slice(1).map((c) => c.id));
    s.clips = s.clips.filter((c) => !drop.has(c.id));
  });
  useApp.setState({ selectedClipIds: [first.id] });
}

/** Repeats only the part of the riff the clip shows (e.g. just the fill bar), instead of the whole riff. */
export function loopVisiblePart(id: string) {
  const c = useApp.getState().song.clips.find((x) => x.id === id);
  if (!c || c.length > loopLength(c) || c.offset + c.length > loopLength(c)) return;
  edit((s) => {
    const x = s.clips.find((y) => y.id === id)!;
    x.loopStart = c.loopStart + c.offset;
    x.loopEnd = x.loopStart + c.length;
    x.offset = 0;
  });
}

/** Repeats the whole riff again, keeping the clip's first note where it is. */
export function loopWholeRiff(id: string) {
  const { song } = useApp.getState();
  const c = song.clips.find((x) => x.id === id);
  const p = c && song.patterns[c.patternId];
  if (!c || !p) return;
  edit((s) => {
    const x = s.clips.find((y) => y.id === id)!;
    x.offset = c.loopStart + c.offset;
    x.loopStart = 0;
    x.loopEnd = p.lengthTicks;
  });
}

/** Sets the loop region inside the riff (dragging the loop brace in the editor). */
export function setClipLoop(id: string, loopStart: number, loopEnd: number, history = true) {
  edit(
    (s) => {
      const c = s.clips.find((x) => x.id === id);
      const p = c && s.patterns[c.patternId];
      if (!c || !p) return;
      const a = Math.max(0, Math.min(Math.round(loopStart), p.lengthTicks - PPQ / 4));
      const b = Math.max(a + PPQ / 4, Math.min(Math.round(loopEnd), p.lengthTicks));
      // Keep the pattern tick at the clip start if it's still inside the loop.
      const first = c.loopStart + c.offset;
      c.loopStart = a;
      c.loopEnd = b;
      c.offset = first >= a && first < b ? first - a : 0;
    },
    { history },
  );
}

export function updatePattern(id: string, recipe: (p: Pattern) => void, history = true) {
  edit(
    (s) => {
      const p = s.patterns[id];
      if (!p) return;
      const oldLen = p.lengthTicks;
      recipe(p as Pattern);
      p.edited = true;
      if (p.lengthTicks !== oldLen) fitClipsToLength(s, id, oldLen, p.lengthTicks);
    },
    { history },
  );
}

/** When a riff gets longer or shorter, clips that looped all of it follow, and loops past the end are clipped. */
export function fitClipsToLength(s: Song, patternId: string, oldLen: number, newLen: number) {
  for (const c of s.clips) {
    if (c.patternId !== patternId) continue;
    const whole = c.loopStart === 0 && c.loopEnd === oldLen;
    if (whole) {
      const passes = c.length / oldLen;
      c.loopEnd = newLen;
      // A clip that played the riff a whole number of times keeps doing so.
      if (Math.abs(passes - Math.round(passes)) < 1e-6 && c.offset === 0) c.length = Math.round(passes) * newLen;
    } else c.loopEnd = Math.min(c.loopEnd, newLen);
    if (c.loopStart >= c.loopEnd) {
      c.loopStart = 0;
      c.loopEnd = newLen;
    }
    c.offset = mod(c.offset, Math.max(1, c.loopEnd - c.loopStart));
  }
}

/** Swaps in a new version of a pattern (revert to file, re-map), letting clips follow a length change. */
export function replacePattern(p: Pattern) {
  edit((s) => {
    const old = s.patterns[p.id];
    s.patterns[p.id] = p;
    if (old && old.lengthTicks !== p.lengthTicks) fitClipsToLength(s, p.id, old.lengthTicks, p.lengthTicks);
  });
}

/** Drops patterns no clip uses. */
function gcPatterns(s: Song) {
  const used = new Set(s.clips.map((c) => c.patternId));
  for (const id of Object.keys(s.patterns)) if (!used.has(id)) delete s.patterns[id];
}

// ---- sections, tempo, loop ----

export function addSection(at: number) {
  const { song } = useApp.getState();
  const m = meterOf(song);
  const start = m.snapBar(at, 'floor');
  const next = song.sections.filter((x) => x.start > start).sort((a, b) => a.start - b.start)[0];
  const end = next ? next.start : Math.max(start + m.barLength(start) * 4, m.snapBar(songEnd(song), 'round'));
  const id = uid('s');
  edit((s) => {
    // Cut the section this lands in.
    for (const x of s.sections) if (x.start < start && x.end > start) x.end = start;
    s.sections.push({ id, name: `Section ${s.sections.length + 1}`, start, end, color: SECTION_COLORS[s.sections.length % SECTION_COLORS.length] });
    s.sections.sort((a, b) => a.start - b.start);
  });
  return id;
}

export function updateSection(id: string, patch: Partial<Section>, history = true) {
  edit(
    (s) => {
      const x = s.sections.find((y) => y.id === id);
      if (x) Object.assign(x, patch);
    },
    { history },
  );
}

export function removeSection(id: string) {
  edit((s) => {
    s.sections = s.sections.filter((x) => x.id !== id);
  });
}

/** Sets the tempo from a tick on (up to the next change). */
export function setTempoAt(tick: number, bpm: number, history = true) {
  const v = Math.max(20, Math.min(400, Math.round(bpm * 10) / 10));
  edit(
    (s) => {
      const pts = s.tempo;
      const exact = pts.find((p) => p.tick === tick);
      if (exact) exact.bpm = v;
      else {
        pts.push({ tick, bpm: v });
        pts.sort((a, b) => a.tick - b.tick);
      }
      // Merge equal neighbours.
      s.tempo = pts.filter((p, i) => i === 0 || p.bpm !== pts[i - 1].bpm);
    },
    { history },
  );
}

/** Changes the tempo that is in effect at a tick. */
export function changeTempoSegment(tick: number, bpm: number, history = true) {
  const pts = useApp.getState().song.tempo;
  let at = pts[0];
  for (const p of pts) if (p.tick <= tick) at = p;
  setTempoAt(at.tick, bpm, history);
}

export function removeTempoPoint(tick: number) {
  if (tick === 0) return;
  edit((s) => {
    s.tempo = s.tempo.filter((p) => p.tick !== tick);
  });
}

/** Makes the song's time signature match a clip's riff over the clip, restoring the old one after it. */
export function matchMeterToClip(clipId: string) {
  const { song } = useApp.getState();
  const c = song.clips.find((x) => x.id === clipId);
  const p = c && song.patterns[c.patternId];
  if (!c || !p) return;
  const m = meterOf(song);
  const end = clipEnd(c, p);
  const before = m.meterAt(c.start);
  const after = m.meterAt(end);
  edit((s) => {
    const pts = s.meter.filter((x) => x.tick < c.start || x.tick > end);
    pts.push({ tick: c.start, num: p.meter[0], den: p.meter[1] });
    if (!s.meter.some((x) => x.tick === end)) pts.push({ tick: end, num: after.num, den: after.den });
    else pts.push(...s.meter.filter((x) => x.tick === end));
    pts.sort((a, b) => a.tick - b.tick);
    // Drop points that repeat the meter before them.
    s.meter = pts.filter((x, i) => i === 0 || x.num !== pts[i - 1].num || x.den !== pts[i - 1].den);
    if (!s.meter.length || s.meter[0].tick > 0) s.meter.unshift({ tick: 0, num: before.num, den: before.den });
  });
}

/**
 * Sets the time signature from a bar line on. Notes stay where they are in time; only the bar grid changes. Later
 * changes keep their place too, nudged onto a bar line of the meter before them, and repeats of the meter before
 * are dropped.
 */
export function setMeterAt(tick: number, num: number, den: number) {
  const n = Math.max(1, Math.min(32, Math.round(num)));
  const d = [1, 2, 4, 8, 16, 32].includes(den) ? den : 4;
  edit((s) => {
    const others = s.meter.filter((p) => p.tick !== tick).map((p) => ({ ...p }));
    s.meter = normalizeMeter([...others, { tick, num: n, den: d }]);
  });
}

export function removeMeterPoint(tick: number) {
  if (tick === 0) return;
  edit((s) => {
    s.meter = normalizeMeter(s.meter.filter((p) => p.tick !== tick).map((p) => ({ ...p })));
  });
}

function normalizeMeter(points: Song['meter']): Song['meter'] {
  const pts = [...points].sort((a, b) => a.tick - b.tick);
  if (!pts.length || pts[0].tick > 0) pts.unshift({ tick: 0, num: pts[0]?.num ?? 4, den: pts[0]?.den ?? 4 });
  const out: Song['meter'] = [pts[0]];
  for (const p of pts.slice(1)) {
    const prev = out[out.length - 1];
    const bar = (prev.num * PPQ * 4) / prev.den;
    const tick = prev.tick + Math.max(1, Math.round((p.tick - prev.tick) / bar)) * bar;
    if (p.num === prev.num && p.den === prev.den) continue;
    if (out.some((x) => x.tick === tick)) continue;
    out.push({ ...p, tick });
  }
  return out;
}

export function setLoop(loop: Partial<Song['loop']>, history = false) {
  edit(
    (s) => {
      Object.assign(s.loop, loop);
      if (s.loop.end < s.loop.start) [s.loop.start, s.loop.end] = [s.loop.end, s.loop.start];
    },
    { history },
  );
}

export const renameSong = (name: string) =>
  edit((s) => {
    s.name = name;
  });

export const DEFAULT_BAR = PPQ * 4;
