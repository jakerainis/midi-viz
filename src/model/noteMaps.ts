/**
 * Note maps turn a MIDI note number into an articulation. Different riff packs were written for different
 * drum plugins, so each pack picks a map (see PACK_MAPS) and the Mapping view lets the user override it.
 */

export type MapStatus = 'ok' | 'fixed' | 'fallback';

export interface NoteMapEntry {
  art: string;
  /** Where the source file meant something the kit doesn't have, or where v1 got it wrong. */
  status?: MapStatus;
  note?: string;
}

export interface NoteMap {
  id: string;
  name: string;
  description: string;
  /** Note names as written in the pack's documentation, if any. */
  sourceNames?: Record<number, string>;
  notes: Record<number, NoteMapEntry>;
  /** Needs a listen before trusting it. */
  needsReview?: boolean;
}

const e = (art: string, status?: MapStatus, note?: string): NoteMapEntry => ({ art, status, note });

/** KVLT Drums II as the plugin ships (read from the Default Kit preset). */
const KVLT2_NATIVE: Record<number, NoteMapEntry> = {
  36: e('kick'),
  38: e('snare'),
  48: e('tom1'),
  47: e('tom2'),
  45: e('tom3'),
  43: e('tom4'),
  41: e('tom5'),
  42: e('hihat_closed'),
  44: e('hihat_pedal'),
  46: e('hihat_semiopen'),
  32: e('hihat_wideopen'),
  49: e('crash1'),
  50: e('crash1_choke'),
  57: e('crash2'),
  58: e('crash2_choke'),
  55: e('splash1'),
  56: e('fx1'),
  59: e('fx2'),
  52: e('china1'),
  61: e('china2'),
  51: e('ride_bow'),
  53: e('ride_bell'),
  54: e('ride_crash'),
};

/** Notes a lot of files use that the plugin map leaves out. */
const COMMON_EXTRAS: Record<number, NoteMapEntry> = {
  35: e('kick', 'fallback', 'Second kick note'),
  37: e('snare', 'fallback', 'Side stick · kit has no cross-stick'),
  39: e('snare', 'fallback', 'Clap or rimshot note · plays snare'),
  40: e('snare', 'fallback', 'Second snare note'),
  24: e('hihat_semiopen', 'fixed', 'Semi-open hat · v1 played nothing'),
};

/** Ugritone's documented map (public/midi/NWOBHM/MAPPING.txt). */
const UGRITONE_CLASSIC: Record<number, NoteMapEntry> = {
  24: e('hihat_semiopen', 'fixed', 'v1 played nothing'),
  36: e('kick'),
  38: e('snare'),
  41: e('tom5'),
  42: e('hihat_closed'),
  43: e('tom4'),
  44: e('hihat_pedal'),
  45: e('tom3'),
  46: e('hihat_wideopen'),
  47: e('tom2'),
  48: e('tom1'),
  49: e('crash1'),
  50: e('crash1_choke', 'fixed', 'v1 played a tom'),
  51: e('ride_bow'),
  52: e('china1'),
  53: e('ride_bell'),
  54: e('ride_crash'),
  55: e('splash1'),
  56: e('splash1', 'fallback', 'Kit has one splash'),
  57: e('crash2'),
  58: e('crash2_choke'),
  59: e('tom1', 'fallback', 'No rototoms · v1 played ride'),
  60: e('tom2', 'fallback', 'No rototoms · v1 played snare'),
  62: e('tom3', 'fallback', 'No rototoms · v1 played snare'),
};

const CLASSIC_NAMES: Record<number, string> = {
  62: 'ROTOTOM3',
  60: 'ROTOTOM2',
  59: 'ROTOTOM1',
  58: 'CRASH2CHOKE',
  57: 'CRASH2',
  56: 'SPLASH2',
  55: 'SPLASH1',
  54: 'RIDECRASH',
  53: 'RIDEBELL',
  52: 'CHINA',
  51: 'RIDE',
  50: 'CRASH1CHOKE',
  49: 'CRASH1',
  48: 'TOM1',
  47: 'TOM2',
  46: 'OPENHH',
  45: 'TOM3',
  44: 'HHPEDAL',
  43: 'TOM4',
  42: 'HHCLOSED',
  41: 'TOM5',
  38: 'SNARE',
  36: 'KICK',
  24: 'SEMIOPENHH',
};

const GENERAL_MIDI: Record<number, NoteMapEntry> = {
  35: e('kick'),
  36: e('kick'),
  37: e('snare', 'fallback', 'Side stick'),
  38: e('snare'),
  39: e('snare', 'fallback', 'Hand clap'),
  40: e('snare'),
  41: e('tom5'),
  42: e('hihat_closed'),
  43: e('tom4'),
  44: e('hihat_pedal'),
  45: e('tom3'),
  46: e('hihat_wideopen'),
  47: e('tom2'),
  48: e('tom1'),
  49: e('crash1'),
  50: e('tom1'),
  51: e('ride_bow'),
  52: e('china1'),
  53: e('ride_bell'),
  55: e('splash1'),
  57: e('crash2'),
  59: e('ride_bow', 'fallback', 'Ride 2'),
};

export const NOTE_MAPS: NoteMap[] = [
  {
    id: 'ugritone',
    name: 'Ugritone packs',
    description: 'Default for every other pack',
    notes: { ...COMMON_EXTRAS, ...KVLT2_NATIVE },
  },
  {
    id: 'ugritone-classic',
    name: 'Ugritone classic',
    description: 'From NWOBHM MAPPING.txt · packs that use note 24',
    sourceNames: CLASSIC_NAMES,
    notes: { ...COMMON_EXTRAS, 32: e('hihat_wideopen'), ...UGRITONE_CLASSIC },
  },
  {
    id: 'prog-death',
    name: 'Prog Death articulations',
    description: 'Notes 22–31 are unknown; assign them by ear',
    needsReview: true,
    notes: { ...COMMON_EXTRAS, ...KVLT2_NATIVE },
  },
  {
    id: 'gm',
    name: 'General MIDI',
    description: 'Fallback for files from anywhere else',
    notes: GENERAL_MIDI,
  },
  {
    id: 'kvlt2',
    name: 'KVLT Drums II native',
    description: 'For MIDI exported from the plugin',
    notes: { ...KVLT2_NATIVE },
  },
];

export const MAP_BY_ID: Record<string, NoteMap> = Object.fromEntries(NOTE_MAPS.map((m) => [m.id, m]));

/** Packs whose files use note 24 for the semi-open hat, which means 46 is the fully open hat (MAPPING.txt). */
const CLASSIC_PACKS = new Set([
  'NWOBHM',
  'Grindcore',
  'Grunge Rock',
  'Heartland Rock',
  'Industrial Metal',
  'Post Metal',
  'Rock Anthology',
  'Street Punk',
]);

export function defaultMapForPack(pack: string): string {
  if (CLASSIC_PACKS.has(pack.trim())) return 'ugritone-classic';
  if (pack.trim() === 'Progressive Death Metal') return 'prog-death';
  return 'ugritone';
}

/** Turns a note into an articulation with a map plus the user's overrides (null = deliberately silent). */
export function resolveNote(
  map: NoteMap,
  note: number,
  overrides?: Record<number, string | null>,
): string | undefined {
  if (overrides && note in overrides) return overrides[note] ?? undefined;
  return map.notes[note]?.art;
}

/** Native note for an articulation in a map, used when exporting. First match wins. */
export function noteForArt(map: NoteMap, art: string): number | undefined {
  for (const [n, entry] of Object.entries(map.notes)) if (entry.art === art && !entry.status) return Number(n);
  for (const [n, entry] of Object.entries(map.notes)) if (entry.art === art) return Number(n);
  return undefined;
}
