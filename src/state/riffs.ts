/** Loading riffs from public/midi into patterns, with the right note map for their pack. */
import { buildLibrary, parseRiffName, riffUrl } from '../model/library';
import type { Manifest, Riff } from '../model/library';
import { hitsFromRaw, meterFromName, readMidi } from '../model/importMidi';
import type { RawMidi } from '../model/importMidi';
import { defaultMapForPack } from '../model/noteMaps';
import { uid } from '../model/types';
import type { Pattern } from '../model/types';
import { setLibrary, useApp } from './store';

const rawCache = new Map<string, Promise<RawMidi>>();

export function fetchRaw(key: string): Promise<RawMidi> {
  let p = rawCache.get(key);
  if (!p) {
    p = fetch(riffUrl(key))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${key}`);
        return r.arrayBuffer();
      })
      .then((buf) => readMidi(buf, meterFromName(key.slice(key.indexOf('/') + 1))));
    p.catch(() => rawCache.delete(key));
    rawCache.set(key, p);
  }
  return p;
}

export function mapIdForPack(pack: string) {
  return useApp.getState().mapping.packMaps[pack.trim()] ?? defaultMapForPack(pack);
}

export function overridesFor(mapId: string) {
  return useApp.getState().mapping.overrides[mapId];
}

export function riffFromKey(key: string): Riff {
  const i = key.indexOf('/');
  return parseRiffName(key.slice(0, i), key.slice(i + 1));
}

/** Builds a fresh pattern for a library riff. */
export async function patternForRiff(key: string): Promise<Pattern> {
  const riff = riffFromKey(key);
  const raw = await fetchRaw(key);
  const mapId = mapIdForPack(riff.pack);
  const { hits, unmapped } = hitsFromRaw(raw, mapId, overridesFor(mapId));
  return {
    id: uid('p'),
    name: riff.name,
    lengthTicks: raw.lengthTicks,
    meter: raw.meter,
    bpm: raw.bpm ?? riff.bpm,
    source: { pack: riff.pack, file: riff.file, mapId },
    hits,
    unmapped: unmapped.length ? unmapped : undefined,
  };
}

/** Re-reads a pattern's source file with its pack's current map (after mapping edits or "Revert to file"). */
export async function reloadPattern(p: Pattern): Promise<Pattern | null> {
  if (!p.source) return null;
  const key = `${p.source.pack}/${p.source.file}`;
  const raw = await fetchRaw(key);
  const mapId = mapIdForPack(p.source.pack);
  const { hits, unmapped } = hitsFromRaw(raw, mapId, overridesFor(mapId));
  return { ...p, hits, unmapped: unmapped.length ? unmapped : undefined, edited: false, lengthTicks: raw.lengthTicks, source: { ...p.source, mapId } };
}

export async function loadLibrary() {
  const res = await fetch('/midi/manifest.json');
  const manifest = (await res.json()) as Manifest;
  setLibrary({ packs: buildLibrary(manifest) });
}
