/**
 * Drum kits. A kit is a `kit.json` manifest (KitManifest v1) plus audio files named relative to it. Built-in kits ship
 * with the app in public/kits and load over HTTP from /kits; kits you add live in this browser (userKits.ts). Both
 * go through the same progressive loader: kick, snare and closed hat first, so a song can start while the rest loads.
 */
import { ART_BY_ID } from '../model/kit';

/** Credits and licence for a kit, shown in the Kit view. */
export interface KitAbout {
  description?: string;
  /** Who made the samples. */
  credit?: string;
  /** Short licence name, e.g. "CC BY 4.0". */
  license?: string;
  licenseUrl?: string;
  /** Where the original samples come from. */
  url?: string;
  /** What was changed from the original (CC licences ask for this). */
  changes?: string;
  /** How the kit's sounds map onto the app's articulations. */
  notes?: string[];
}

export interface KitLayer {
  /** The velocity this layer was played at, 1–127. Layers are listed soft to hard. */
  velocity: number;
  /** Round-robins, relative to kit.json. */
  files: string[];
}

export interface KitArticulation {
  id: string;
  piece: string;
  note: number;
  layers: KitLayer[];
  silent?: boolean;
  /** The kit has no sample of its own here and plays this other articulation's samples. */
  from?: string;
}

export interface KitManifest {
  version: 1;
  id: string;
  name: string;
  about?: KitAbout;
  /** How the samples were made, when a tool wrote the manifest (shown as-is). */
  source?: { plugin?: string; pluginVersion?: string; set?: string; preset?: string; renderedAt?: string };
  sampleRate: number;
  pieces?: { id: string; panel?: string; sampleName?: string }[];
  articulations: KitArticulation[];
}

/** One entry of public/kits/index.json. The first entry is the default kit. */
export interface KitIndexEntry {
  id: string;
  name: string;
  /** Path of the kit.json, relative to /kits. */
  path: string;
}

export interface Layer {
  velocity: number;
  buffers: AudioBuffer[];
}

export interface LoadedKit {
  id: string;
  name: string;
  /** Ships with the app (public/kits), as opposed to a kit stored in this browser. */
  builtin: boolean;
  manifest: KitManifest;
  /** Articulation id → velocity layers, ascending. Filled in while the kit loads. */
  layers: Map<string, Layer[]>;
  /** Seconds of audio loaded, for the Kit view. */
  seconds: number;
  /** Files that could not be read or decoded. */
  failed: string[];
}

/** Reads one file named in a manifest. */
export type ReadFile = (path: string) => Promise<ArrayBuffer>;

/** A kit ready to load: its manifest and a way to read its files. */
export interface KitSource {
  manifest: KitManifest;
  read: ReadFile;
  builtin: boolean;
}

/** Load these first: with them a song is recognisable, so playback can start while the rest loads. */
export const FIRST_ARTICULATIONS = ['kick', 'snare', 'hihat_closed'];

const KITS_URL = `${import.meta.env.BASE_URL}kits/`;

export const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Runs async jobs in order with a concurrency limit. */
async function pool(jobs: (() => Promise<void>)[], limit: number) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

export async function fetchKitIndex(): Promise<KitIndexEntry[]> {
  const res = await fetch(`${KITS_URL}index.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`The kit list (/kits/index.json) answered ${res.status}.`);
  const data = await res.json();
  if (!Array.isArray(data?.kits)) throw new Error('The kit list (/kits/index.json) has no "kits" array.');
  return data.kits.filter((k: unknown): k is KitIndexEntry => {
    const e = k as Partial<KitIndexEntry> | null;
    return typeof e?.id === 'string' && typeof e.name === 'string' && typeof e.path === 'string';
  });
}

/** A kit that ships with the app, read from /kits over HTTP. */
export async function builtinSource(entry: KitIndexEntry): Promise<KitSource> {
  const res = await fetch(`${KITS_URL}${encodePath(entry.path)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${entry.name}: kit.json answered ${res.status}.`);
  const manifest = parseManifest(await res.json(), entry.id).manifest;
  const dir = entry.path.split('/').slice(0, -1).join('/');
  const base = `${KITS_URL}${dir ? `${encodePath(dir)}/` : ''}`;
  const read: ReadFile = async (p) => {
    const r = await fetch(`${base}${encodePath(p)}`);
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.arrayBuffer();
  };
  return { manifest: { ...manifest, id: entry.id, name: manifest.name || entry.name }, read, builtin: true };
}

/** A relative path inside a kit folder, or null when it points outside it. */
export function cleanPath(p: string) {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}

const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined);
/** Links from an imported kit.json are shown in the page, so only plain web links pass. */
const webUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\/[^\s]+$/i.test(s) ? s : undefined;
};

function cleanAbout(a: unknown): KitAbout | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const r = a as Record<string, unknown>;
  const about: KitAbout = {
    description: str(r.description),
    credit: str(r.credit),
    license: str(r.license),
    licenseUrl: webUrl(r.licenseUrl),
    url: webUrl(r.url),
    changes: str(r.changes),
    notes: Array.isArray(r.notes) ? r.notes.map(str).filter((n): n is string => !!n).slice(0, 40) : undefined,
  };
  return Object.values(about).some((v) => v !== undefined) ? about : undefined;
}

/**
 * Checks a kit.json and fills in what the app can work out itself (piece, note, sample rate). Throws with a
 * readable message when it isn't a kit manifest. `warnings` lists what was dropped or isn't known.
 */
export function parseManifest(data: unknown, fallbackId: string): { manifest: KitManifest; warnings: string[] } {
  const d = data as Partial<KitManifest> | null;
  if (!d || typeof d !== 'object') throw new Error('kit.json is not a JSON object.');
  if (d.version !== undefined && d.version !== 1) throw new Error(`kit.json is version ${String(d.version)}; this app reads version 1.`);
  if (!Array.isArray(d.articulations)) throw new Error('kit.json has no "articulations" list.');
  const warnings: string[] = [];
  const unknown: string[] = [];
  const articulations: KitArticulation[] = [];
  for (const raw of d.articulations as Partial<KitArticulation>[]) {
    if (!raw || typeof raw.id !== 'string') continue;
    const def = ART_BY_ID[raw.id];
    if (!def) unknown.push(raw.id);
    const layers: KitLayer[] = [];
    for (const l of Array.isArray(raw.layers) ? raw.layers : []) {
      if (!l || typeof l.velocity !== 'number' || !Array.isArray(l.files)) continue;
      const files = l.files.filter((f): f is string => typeof f === 'string').map(cleanPath).filter((f): f is string => !!f);
      if (files.length) layers.push({ velocity: clampVel(l.velocity), files });
    }
    layers.sort((a, b) => a.velocity - b.velocity);
    articulations.push({
      id: raw.id,
      piece: typeof raw.piece === 'string' ? raw.piece : (def?.piece ?? raw.id),
      note: typeof raw.note === 'number' ? raw.note : (def?.note ?? 0),
      layers,
      ...(raw.silent ? { silent: true } : {}),
      ...(typeof raw.from === 'string' ? { from: raw.from } : {}),
    });
  }
  if (unknown.length) warnings.push(`Skipped ${unknown.length} articulation${unknown.length > 1 ? 's' : ''} the app doesn't know: ${unknown.join(', ')}.`);
  const manifest: KitManifest = {
    version: 1,
    id: typeof d.id === 'string' && d.id ? d.id : fallbackId,
    name: typeof d.name === 'string' && d.name ? d.name : fallbackId,
    sampleRate: typeof d.sampleRate === 'number' && d.sampleRate > 0 ? d.sampleRate : 44100,
    articulations: articulations.filter((a) => ART_BY_ID[a.id]),
  };
  const about = cleanAbout(d.about);
  if (about) manifest.about = about;
  if (d.source && typeof d.source === 'object') {
    const s = d.source as Record<string, unknown>;
    manifest.source = { plugin: str(s.plugin), pluginVersion: str(s.pluginVersion), set: str(s.set), preset: str(s.preset), renderedAt: str(s.renderedAt) };
  }
  if (Array.isArray(d.pieces))
    manifest.pieces = d.pieces
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({ id: p.id, ...(str(p.panel) ? { panel: str(p.panel) } : {}), ...(str(p.sampleName) ? { sampleName: str(p.sampleName) } : {}) }));
  return { manifest, warnings };
}

/** Every file a manifest names, once. */

export interface LoadOptions {
  /** 0–1, as files arrive. */
  onProgress?: (p: number) => void;
  /** Called once kick, snare and closed hat are in, with the kit as loaded so far (it keeps filling in). */
  onPlayable?: (kit: LoadedKit) => void;
  /** Stop early (another kit was picked). */
  cancelled?: () => boolean;
}

/**
 * Decodes a kit's samples into a LoadedKit. Files are decoded once, even when several articulations share them.
 * Order: kick, snare and closed hat completely; then one round-robin of every layer of everything else; then the
 * remaining round-robins. `kit.layers` only ever holds layers that have at least one sample.
 */
export async function loadKit(ctx: BaseAudioContext, src: KitSource, opts: LoadOptions = {}): Promise<LoadedKit> {
  const { manifest } = src;
  const kit: LoadedKit = { id: manifest.id, name: manifest.name, builtin: src.builtin, manifest, layers: new Map(), seconds: 0, failed: [] };
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decodeOnce = (path: string) => {
    let p = decoded.get(path);
    if (!p) {
      p = src
        .read(path)
        .then((data) => ctx.decodeAudioData(data))
        .then(
          (buf) => {
            kit.seconds += buf.duration;
            return buf;
          },
          (err: unknown) => {
            console.warn(`Kit sample ${path} failed`, err);
            kit.failed.push(path);
            return null;
          },
        );
      decoded.set(path, p);
    }
    return p;
  };

  interface Slot {
    art: string;
    layers: { velocity: number; files: string[]; buffers: (AudioBuffer | null | undefined)[] }[];
  }
  const slots: Slot[] = manifest.articulations
    .filter((a) => !a.silent && a.layers.length)
    .map((a) => ({ art: a.id, layers: a.layers.map((l) => ({ velocity: l.velocity, files: l.files, buffers: [] })) }));
  const publish = (s: Slot) => {
    const ls = s.layers
      .map((l) => ({ velocity: l.velocity, buffers: l.buffers.filter((b): b is AudioBuffer => !!b) }))
      .filter((l) => l.buffers.length);
    if (ls.length) kit.layers.set(s.art, ls);
    else kit.layers.delete(s.art);
  };

  type Job = { slot: Slot; layer: number; rr: number; first: boolean };
  const jobs: Job[] = [];
  const firsts = slots.filter((s) => FIRST_ARTICULATIONS.includes(s.art));
  const rest = slots.filter((s) => !FIRST_ARTICULATIONS.includes(s.art));
  const rrMax = Math.max(0, ...slots.flatMap((s) => s.layers.map((l) => l.files.length)));
  for (const s of firsts) s.layers.forEach((l, li) => l.files.forEach((_, rr) => jobs.push({ slot: s, layer: li, rr, first: true })));
  for (let rr = 0; rr < rrMax; rr++)
    for (const s of rest) s.layers.forEach((l, li) => rr < l.files.length && jobs.push({ slot: s, layer: li, rr, first: false }));

  let done = 0;
  let firstLeft = jobs.filter((j) => j.first).length;
  const playable = () => {
    if (!opts.cancelled?.()) opts.onPlayable?.(kit);
  };
  if (!firstLeft) playable();
  await pool(
    jobs.map((j) => async () => {
      if (opts.cancelled?.()) return;
      const l = j.slot.layers[j.layer];
      l.buffers[j.rr] = await decodeOnce(l.files[j.rr]);
      publish(j.slot);
      opts.onProgress?.(++done / jobs.length);
      if (j.first && --firstLeft === 0) playable();
    }),
    6,
  );
  return kit;
}
