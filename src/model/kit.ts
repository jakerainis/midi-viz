/**
 * The drum articulations the app knows, one editor lane each. Kits (public/kits, or kits you load) provide samples
 * per articulation id. The set and `note` numbers follow Ugritone KVLT Drums II's map, which many of the riff packs
 * were written for.
 */

export type LaneGroup = 'cymbals' | 'hihat' | 'snare' | 'toms' | 'kick';

export interface Articulation {
  id: string;
  piece: string;
  name: string;
  /** Short lane label. */
  short: string;
  group: LaneGroup;
  /** KVLT Drums II native note. */
  note: number;
  /** Hits in the same choke group cut each other off when `chokes` is true (hi-hat, cymbal grabs). */
  chokeGroup?: string;
  chokes?: boolean;
}

export const ARTICULATIONS: Articulation[] = [
  { id: 'china2', piece: 'china2', name: 'China 2', short: 'China 2', group: 'cymbals', note: 61 },
  { id: 'china1', piece: 'china1', name: 'China 1', short: 'China', group: 'cymbals', note: 52 },
  { id: 'fx2', piece: 'fx2', name: 'FX cymbal 2 (stack)', short: 'Stack', group: 'cymbals', note: 59 },
  { id: 'fx1', piece: 'fx1', name: 'FX cymbal 1', short: 'FX', group: 'cymbals', note: 56 },
  { id: 'splash1', piece: 'splash1', name: 'Splash', short: 'Splash', group: 'cymbals', note: 55 },
  { id: 'crash2', piece: 'crash2', name: 'Crash 2', short: 'Crash 2', group: 'cymbals', note: 57, chokeGroup: 'crash2' },
  { id: 'crash2_choke', piece: 'crash2', name: 'Crash 2 · Choke', short: 'Crash 2 choke', group: 'cymbals', note: 58, chokeGroup: 'crash2', chokes: true },
  { id: 'crash1', piece: 'crash1', name: 'Crash 1', short: 'Crash 1', group: 'cymbals', note: 49, chokeGroup: 'crash1' },
  { id: 'crash1_choke', piece: 'crash1', name: 'Crash 1 · Choke', short: 'Crash 1 choke', group: 'cymbals', note: 50, chokeGroup: 'crash1', chokes: true },
  { id: 'ride_crash', piece: 'ride', name: 'Ride · Crash', short: 'Ride crash', group: 'cymbals', note: 54 },
  { id: 'ride_bell', piece: 'ride', name: 'Ride · Bell', short: 'Ride bell', group: 'cymbals', note: 53 },
  { id: 'ride_bow', piece: 'ride', name: 'Ride', short: 'Ride', group: 'cymbals', note: 51 },
  { id: 'hihat_wideopen', piece: 'hihat', name: 'Hi-hat · Open', short: 'Hat open', group: 'hihat', note: 32, chokeGroup: 'hihat', chokes: true },
  { id: 'hihat_semiopen', piece: 'hihat', name: 'Hi-hat · Semi-open', short: 'Hat semi', group: 'hihat', note: 46, chokeGroup: 'hihat', chokes: true },
  { id: 'hihat_closed', piece: 'hihat', name: 'Hi-hat · Closed', short: 'Hat closed', group: 'hihat', note: 42, chokeGroup: 'hihat', chokes: true },
  { id: 'hihat_pedal', piece: 'hihat', name: 'Hi-hat · Pedal', short: 'Hat pedal', group: 'hihat', note: 44, chokeGroup: 'hihat', chokes: true },
  { id: 'snare', piece: 'snare', name: 'Snare', short: 'Snare', group: 'snare', note: 38 },
  { id: 'tom1', piece: 'tom1', name: 'Tom 1', short: 'Tom 1', group: 'toms', note: 48 },
  { id: 'tom2', piece: 'tom2', name: 'Tom 2', short: 'Tom 2', group: 'toms', note: 47 },
  { id: 'tom3', piece: 'tom3', name: 'Tom 3', short: 'Tom 3', group: 'toms', note: 45 },
  { id: 'tom4', piece: 'tom4', name: 'Tom 4', short: 'Tom 4', group: 'toms', note: 43 },
  { id: 'tom5', piece: 'tom5', name: 'Tom 5', short: 'Tom 5', group: 'toms', note: 41 },
  { id: 'kick', piece: 'kick', name: 'Kick', short: 'Kick', group: 'kick', note: 36 },
];

export const ART_BY_ID: Record<string, Articulation> = Object.fromEntries(ARTICULATIONS.map((a) => [a.id, a]));

/** Lane order, top to bottom, as in the editor. */
export const LANE_ORDER = ARTICULATIONS.map((a) => a.id);

export const GROUP_LABEL: Record<LaneGroup, string> = {
  cymbals: 'Cymbals',
  hihat: 'Hi-hat',
  snare: 'Snare',
  toms: 'Toms',
  kick: 'Kick',
};

/** The kit pieces (one per plugin panel). */
export const PIECES = [
  { id: 'kick', name: 'Kick' },
  { id: 'snare', name: 'Snare' },
  { id: 'tom1', name: 'Tom 1' },
  { id: 'tom2', name: 'Tom 2' },
  { id: 'tom3', name: 'Tom 3' },
  { id: 'tom4', name: 'Tom 4' },
  { id: 'tom5', name: 'Tom 5' },
  { id: 'hihat', name: 'Hi-hat' },
  { id: 'crash1', name: 'Crash 1' },
  { id: 'crash2', name: 'Crash 2' },
  { id: 'splash1', name: 'Splash' },
  { id: 'fx1', name: 'FX cymbal 1' },
  { id: 'fx2', name: 'FX cymbal 2' },
  { id: 'china1', name: 'China 1' },
  { id: 'china2', name: 'China 2' },
  { id: 'ride', name: 'Ride' },
];
