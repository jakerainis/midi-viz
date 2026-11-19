/** "Grind demo": the arrangement from the design canvas, built from real Grindcore riffs. */
import { PPQ, newClip, uid } from '../model/types';
import type { Clip, Pattern, Song } from '../model/types';
import { patternForRiff } from './riffs';
import { ACCENTS } from './store';
import { SECTION_COLORS } from './songActions';

const BAR = PPQ * 4;

export async function buildDemoSong(): Promise<Song> {
  const keys = {
    mid: 'Grindcore/170bpmMidtempoGrind3.mid',
    dbeat: 'Grindcore/200bpmDBeat4.mid',
    blast: 'Grindcore/200bpmOneArmBlast2.mid',
    breakdown: 'Grindcore/172bpmBreakdownUno1.mid',
    fill7: 'Grindcore/Fill7.mid',
    fill2: 'Grindcore/Fill2.mid',
    fill11: 'Grindcore/Fill11.mid',
    snareBlast: 'Grindcore/205bpmSnareBlast3.mid',
    panic: 'Grindcore/210bpmPanicBlast1.mid',
  };
  const entries = await Promise.all(
    Object.entries(keys).map(async ([k, key]) => [k, await patternForRiff(key).catch(() => null)] as const),
  );
  const p = Object.fromEntries(entries) as Record<keyof typeof keys, Pattern | null>;

  const main = uid('t');
  const ideas = uid('t');
  const patterns: Record<string, Pattern> = {};
  const clips: Clip[] = [];
  const sections: Song['sections'] = [];
  const tempo: Song['tempo'] = [];
  const bars = (pat: Pattern | null) => (pat ? pat.lengthTicks / BAR : 0);

  // Sections follow the riffs: each one repeats its riff to at least `minBars`.
  let at = 0;
  const section = (name: string, color: string, pat: Pattern | null, minBars: number, bpm: number, reuse?: Pattern | null) => {
    const use = reuse ?? pat;
    if (!use) return;
    patterns[use.id] = use;
    const repeats = Math.max(1, Math.ceil(minBars / bars(use)));
    clips.push(newClip(main, use, at * BAR, repeats * use.lengthTicks));
    const end = at + repeats * bars(use);
    sections.push({ id: uid('s'), name, start: at * BAR, end: end * BAR, color });
    if (!tempo.length || tempo[tempo.length - 1].bpm !== bpm) tempo.push({ tick: at * BAR, bpm });
    at = end;
  };
  /** A fill at the end of a section, on the beat's track: the beat clip there is cropped to make room. */
  const fillAt = (pat: Pattern | null, endTick: number) => {
    if (!pat) return;
    const beat = clips.find((c) => c.trackId === main && c.start < endTick && c.start + c.length >= endTick);
    if (!beat || beat.length <= pat.lengthTicks) return;
    beat.length -= pat.lengthTicks;
    patterns[pat.id] = pat;
    clips.push(newClip(main, pat, endTick - pat.lengthTicks));
  };
  const idea = (pat: Pattern | null, startTick: number) => {
    if (!pat) return;
    patterns[pat.id] = pat;
    clips.push(newClip(ideas, pat, startTick));
  };

  section('Intro', SECTION_COLORS[0], p.mid, 4, 170);
  section('Verse', SECTION_COLORS[1], p.dbeat, 8, 200);
  section('Blast', SECTION_COLORS[2], p.blast, 8, 200);
  section('Breakdown', SECTION_COLORS[3], p.breakdown, 8, 172);
  // Verse 2 reuses the verse groove as a linked copy.
  section('Verse 2', SECTION_COLORS[1], null, 8, 200, p.dbeat);
  fillAt(p.fill7, sections[1]?.end ?? 0);
  fillAt(p.fill2, sections[2]?.end ?? 0);
  fillAt(p.fill11, sections[3]?.end ?? 0);
  idea(p.snareBlast, sections[2]?.start ?? 0);
  idea(p.panic, sections[3]?.start ?? 0);
  const blast = sections[2];

  return {
    id: uid('song'),
    name: 'Grind demo',
    tempo: tempo.length ? tempo : [{ tick: 0, bpm: 170 }],
    meter: [{ tick: 0, num: 4, den: 4 }],
    sections,
    tracks: [
      { id: main, name: 'Drums', color: ACCENTS[0], mute: false, solo: false, volumeDb: 0 },
      { id: ideas, name: 'Ideas', color: '#7C8390', mute: true, solo: false, volumeDb: 0 },
    ],
    clips,
    patterns,
    loop: blast ? { start: blast.start, end: blast.end, on: false } : { start: 0, end: 8 * BAR, on: false },
  };
}
