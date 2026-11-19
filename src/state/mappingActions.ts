/**
 * Mapping edits (which map each pack uses, per-note overrides), the library note scan from
 * public/midi/note-usage.json (written by scripts/note-usage.mjs), and re-mapping song clips after an edit.
 */
import { hitsFromRaw } from '../model/importMidi';
import { MAP_BY_ID, defaultMapForPack, resolveNote } from '../model/noteMaps';
import type { Hit, Pattern, Song, UnmappedNote } from '../model/types';
import { fetchRaw, reloadPattern } from './riffs';
import { edit, setMapping, useApp } from './store';
import type { AppState } from './store';

export type MappingState = AppState['mapping'];

/** Patterns from the user's own files: there is no source file in the library to re-read. */
export const IMPORTED_PACK = 'Imported';

/** The map a pack uses under the given settings (same rule as `mapIdForPack`). */
export const packMapId = (mapping: MappingState, pack: string) => mapping.packMaps[pack.trim()] ?? defaultMapForPack(pack);

export const selectMap = (selectedMapId: string) => setMapping({ selectedMapId });

/** Picks the map a pack uses. Choosing the pack's default clears the choice. */
export function setPackMap(pack: string, mapId: string) {
  const name = pack.trim();
  const packMaps = { ...useApp.getState().mapping.packMaps };
  if (mapId === defaultMapForPack(name)) delete packMaps[name];
  else packMaps[name] = mapId;
  setMapping({ packMaps });
}

/**
 * Sets what a note plays in a map: an articulation, `null` for silent on purpose, or `undefined` to go back to
 * the map's own entry. Picking what the map already says clears the override.
 */
export function setNoteOverride(mapId: string, note: number, art: string | null | undefined) {
  const { overrides } = useApp.getState().mapping;
  const forMap = { ...(overrides[mapId] ?? {}) };
  const builtin = MAP_BY_ID[mapId]?.notes[note]?.art;
  if (art === undefined || (art !== null && art === builtin)) delete forMap[note];
  else forMap[note] = art;
  const next = { ...overrides };
  if (Object.keys(forMap).length) next[mapId] = forMap;
  else delete next[mapId];
  setMapping({ overrides: next });
}

export function resetOverrides(mapId: string) {
  const next = { ...useApp.getState().mapping.overrides };
  delete next[mapId];
  setMapping({ overrides: next });
}

// ---- library scan ----

export interface NoteCount {
  hits: number;
  files: number;
}

export interface NoteUsage {
  version: 1;
  generatedAt: string;
  files: number;
  hits: number;
  /** Trimmed pack name → riff count and note → counts. */
  packs: Record<string, { files: number; notes: Record<string, NoteCount> }>;
}

let usage: Promise<NoteUsage | null> | null = null;

/** Fetches the scan once. Resolves to null when it hasn't been generated (`npm run note-usage`). */
export function loadNoteUsage(): Promise<NoteUsage | null> {
  usage ??= fetch('/midi/note-usage.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<NoteUsage>) : null))
    .then((d) => (d && typeof d === 'object' && d.packs ? d : null))
    .catch(() => null);
  return usage;
}

export interface PackGap {
  pack: string;
  mapId: string;
  files: number;
  notes: { note: number; hits: number; files: number }[];
}

/** Per pack, the notes its riffs use that its current map gives no sound (deliberate silences excluded). */
export function noteGaps(scan: NoteUsage, mapping: MappingState): PackGap[] {
  const out: PackGap[] = [];
  for (const [pack, info] of Object.entries(scan.packs)) {
    const mapId = packMapId(mapping, pack);
    const map = MAP_BY_ID[mapId];
    const ov = mapping.overrides[mapId];
    const notes = Object.entries(info.notes)
      .map(([n, c]) => ({ note: Number(n), ...c }))
      .filter(({ note }) => !(ov && note in ov) && (!map || resolveNote(map, note) === undefined));
    if (notes.length) out.push({ pack, mapId, files: info.files, notes });
  }
  return out;
}

// ---- re-mapping clips in the song ----

export interface RemapPlan {
  /** Unedited library patterns whose notes would change under the current mapping. */
  fresh: string[];
  /** Patterns the mapping would change but that are left alone: edited by hand, or imported files. */
  edited: string[];
  imported: string[];
}

const hitKey = (h: Pick<Hit, 'tick' | 'note' | 'art' | 'vel'>) => `${h.tick}:${h.note ?? ''}:${h.art}:${h.vel}`;
const hitsSig = (hits: Pick<Hit, 'tick' | 'note' | 'art' | 'vel'>[]) => hits.map(hitKey).sort().join('|');
const unmappedSig = (u: UnmappedNote[] | undefined) => (u ?? []).map((x) => `${x.note}:${x.count}`).join('|');

/** Whether the mapping would play a pattern differently, judged from its own hits (no source file needed). */
function changedByNotes(p: Pattern, mapping: MappingState, mapId: string) {
  const map = MAP_BY_ID[mapId];
  if (!map) return false;
  const ov = mapping.overrides[mapId];
  return (
    p.source?.mapId !== mapId ||
    p.hits.some((h) => h.note !== undefined && resolveNote(map, h.note, ov) !== h.art) ||
    !!p.unmapped?.some((u) => resolveNote(map, u.note, ov) !== undefined || (ov && u.note in ov))
  );
}

/**
 * Finds the song's patterns that the current mapping would read differently. Unedited library patterns are
 * compared against a fresh read of their file, so the answer is exact; edited and imported ones are judged
 * from the note numbers their hits kept.
 */
export async function planRemap(song: Song, mapping: MappingState): Promise<RemapPlan> {
  const plan: RemapPlan = { fresh: [], edited: [], imported: [] };
  await Promise.all(
    Object.values(song.patterns).map(async (p) => {
      if (!p.source) return;
      const mapId = packMapId(mapping, p.source.pack);
      if (p.source.pack === IMPORTED_PACK) {
        // Imported files keep the map that was detected for them; only overrides on that map apply.
        if (changedByNotes(p, mapping, p.source.mapId)) plan.imported.push(p.id);
        return;
      }
      if (p.edited) {
        if (changedByNotes(p, mapping, mapId)) plan.edited.push(p.id);
        return;
      }
      if (p.source.mapId !== mapId) {
        plan.fresh.push(p.id);
        return;
      }
      try {
        const raw = await fetchRaw(`${p.source.pack}/${p.source.file}`);
        const { hits, unmapped } = hitsFromRaw(raw, mapId, mapping.overrides[mapId]);
        if (hitsSig(hits) !== hitsSig(p.hits) || unmappedSig(unmapped) !== unmappedSig(p.unmapped)) plan.fresh.push(p.id);
      } catch {
        /* source file missing: nothing to re-read */
      }
    }),
  );
  return plan;
}

/**
 * Re-reads unedited patterns from their source files with the current mapping and swaps them into the song as
 * one undo step. Returns the ids of the patterns that were replaced.
 */
export async function remapPatterns(ids: string[]): Promise<string[]> {
  const { song } = useApp.getState();
  const targets = ids.map((id) => song.patterns[id]).filter((p): p is Pattern => !!p && !p.edited && p.source?.pack !== IMPORTED_PACK);
  const fresh = (await Promise.all(targets.map((p) => reloadPattern(p).catch(() => null)))).filter((p): p is Pattern => !!p);
  const done: string[] = [];
  edit((s) => {
    for (const p of fresh) {
      const cur = s.patterns[p.id];
      // Skip anything edited or removed while the files were loading.
      if (!cur || cur.edited) continue;
      s.patterns[p.id] = p;
      done.push(p.id);
    }
  });
  return done;
}

/** Clips that play any of the given patterns. */
export const clipsUsing = (song: Song, patternIds: string[]) => {
  const set = new Set(patternIds);
  return song.clips.filter((c) => set.has(c.patternId)).length;
};
