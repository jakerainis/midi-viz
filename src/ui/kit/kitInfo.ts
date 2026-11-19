/** Read-only facts about the loaded kit for the Kit view. */
import type { LoadedKit } from '../../audio/kit';
import { ARTICULATIONS, PIECES } from '../../model/kit';
import type { Articulation } from '../../model/kit';

/** Main articulation first: closed hat before pedal and open, ride bow before bell, a crash before its choke. */
const ORDER = ['hihat_closed', 'hihat_pedal', 'hihat_semiopen', 'hihat_wideopen', 'ride_bow', 'ride_bell', 'ride_crash'];
const rank = (a: Articulation) => (ORDER.includes(a.id) ? ORDER.indexOf(a.id) : a.chokes ? 1 : 0);

export const artsOf = (piece: string) => ARTICULATIONS.filter((a) => a.piece === piece).sort((a, b) => rank(a) - rank(b));

/** "Semi-open" from "Hi-hat · Semi-open"; the piece name for a piece's main articulation. */
export const artLabel = (a: Articulation) => a.name.split(' · ')[1] ?? a.name;

/** The note the kit itself puts this articulation on (its kit.json), else the app's own. */
export function noteOf(kit: LoadedKit | null, a: Articulation) {
  return kit?.manifest.articulations.find((x) => x.id === a.id)?.note ?? a.note;
}

/** The kit's own name for the drum on a piece ("Left crash"), when its kit.json gives one. */
export function sampleNameOf(kit: LoadedKit | null, piece: string) {
  const name = kit?.manifest.pieces?.find((p) => p.id === piece)?.sampleName;
  return name && name !== 'Disabled' ? name : undefined;
}

/** The articulation whose samples this one borrows, when the kit has none of its own for it. */
export function borrowedFrom(kit: LoadedKit | null, art: string) {
  const from = kit?.manifest.articulations.find((x) => x.id === art)?.from;
  return from ? ARTICULATIONS.find((a) => a.id === from) : undefined;
}

/** "5 layers × 3" for a piece list row when the kit doesn't name its drums. */
export function shapeOf(kit: LoadedKit | null, art: string) {
  const ls = kit?.layers.get(art);
  if (!ls?.length) return undefined;
  const rr = ls.reduce((m, l) => Math.max(m, l.buffers.length), 0);
  return `${ls.length} layer${ls.length > 1 ? 's' : ''} × ${rr}`;
}


export const hasSound = (kit: LoadedKit | null, art: string) => !!kit?.layers.get(art)?.some((l) => l.buffers.length);

/** The layer the engine plays for a velocity: the nearest one, lower on a tie (AudioEngine.pick). */
export function nearestLayer(layers: { velocity: number }[], vel: number) {
  let best = 0;
  for (let i = 1; i < layers.length; i++) if (Math.abs(layers[i].velocity - vel) < Math.abs(layers[best].velocity - vel)) best = i;
  return best;
}

/** Distinct samples (a kit may share files between articulations). */
export function sampleCount(kit: LoadedKit | null) {
  const seen = new Set<AudioBuffer>();
  for (const ls of kit?.layers.values() ?? []) for (const l of ls) for (const b of l.buffers) seen.add(b);
  return seen.size;
}

const pieceName = (id: string) => PIECES.find((p) => p.id === id)?.name ?? id;

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Choke behaviour as the engine applies it, from `chokeGroup` / `chokes` in model/kit.ts. */
export function chokeRules(): { name: string; rule: string }[] {
  const groups = new Map<string, Articulation[]>();
  for (const a of ARTICULATIONS) if (a.chokeGroup) groups.set(a.chokeGroup, [...(groups.get(a.chokeGroup) ?? []), a]);
  const pieceIndex = (id: string) => PIECES.findIndex((p) => p.id === id);
  const ordered = [...groups.values()].sort((a, b) => pieceIndex(a[0].piece) - pieceIndex(b[0].piece));
  return ordered.map((group) => {
    const arts = group.slice().sort((a, b) => rank(a) - rank(b));
    const piece = pieceName(arts[0].piece);
    const chokers = arts.filter((a) => a.chokes);
    if (chokers.length === arts.length) {
      return {
        name: piece,
        rule: `${joinAnd(arts.map(artLabel))} cut each other off: each new ${piece.toLowerCase()} hit stops the one still ringing.`,
      };
    }
    const ringing = joinAnd(arts.filter((a) => !a.chokes).map((a) => a.name));
    return {
      name: piece,
      rule: chokers.map((c) => `Choke (note ${c.note}) plays its grab sample and cuts the ringing ${ringing.toLowerCase()}.`).join(' '),
    };
  });
}

export function formatDuration(sec: number) {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  return `${m} min ${Math.round(sec - m * 60)} s`;
}

export function formatDb(db: number) {
  if (db <= -60) return '−∞';
  const sign = db > 0 ? '+' : db < 0 ? '−' : '';
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}
