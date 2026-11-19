/** Edits to the notes of a pattern (the drum editor). Every clip that shares the pattern changes with it. */
import { ART_BY_ID } from '../model/kit';
import { MAP_BY_ID, noteForArt, resolveNote } from '../model/noteMaps';
import { uid } from '../model/types';
import type { Hit, Pattern } from '../model/types';
import { updatePattern } from './songActions';
import { useApp } from './store';

const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

export function addHits(patternId: string, hits: Omit<Hit, 'id'>[], history = true) {
  const ids = hits.map(() => uid('h'));
  updatePattern(
    patternId,
    (p) => {
      hits.forEach((h, i) => {
        // One hit per lane per tick.
        if (p.hits.some((x) => x.art === h.art && x.tick === h.tick)) return;
        p.hits.push({ ...h, id: ids[i] });
      });
      p.hits.sort((a, b) => a.tick - b.tick);
    },
    history,
  );
  return ids;
}

export function deleteHits(patternId: string, ids: string[], history = true) {
  if (!ids.length) return;
  const set = new Set(ids);
  updatePattern(
    patternId,
    (p) => {
      p.hits = p.hits.filter((h) => !set.has(h.id));
    },
    history,
  );
  useApp.setState((s) => ({ selectedHitIds: s.selectedHitIds.filter((x) => !set.has(x)) }));
}

/** Moves hits by ticks and/or to other lanes. `lanes` is the lane order shown, `laneOf` gives a hit's lane. */
export function moveHits(
  patternId: string,
  moves: { id: string; tick: number; art?: string; note?: number }[],
  history = true,
) {
  updatePattern(
    patternId,
    (p) => {
      const byId = new Map(p.hits.map((h) => [h.id, h]));
      for (const m of moves) {
        const h = byId.get(m.id);
        if (!h) continue;
        h.tick = Math.max(0, Math.min(p.lengthTicks - 1, Math.round(m.tick)));
        if (m.art) h.art = m.art;
        if (m.note !== undefined) h.note = m.note;
      }
      p.hits.sort((a, b) => a.tick - b.tick);
    },
    history,
  );
}

export function setVelocities(patternId: string, fn: (h: Hit, index: number, all: Hit[]) => number, ids: string[], history = true) {
  const set = new Set(ids);
  updatePattern(
    patternId,
    (p) => {
      const sel = p.hits.filter((h) => set.has(h.id)).sort((a, b) => a.tick - b.tick);
      sel.forEach((h, i) => {
        h.vel = clampVel(fn(h, i, sel));
      });
    },
    history,
  );
}

/** Pulls hits toward the grid. strength 1 = fully on the grid. */
export function quantize(patternId: string, grid: number, ids: string[] | null, strength = 1) {
  const set = ids ? new Set(ids) : null;
  updatePattern(patternId, (p) => {
    for (const h of p.hits) {
      if (set && !set.has(h.id)) continue;
      const target = Math.round(h.tick / grid) * grid;
      h.tick = Math.min(p.lengthTicks - 1, Math.round(h.tick + (target - h.tick) * strength));
    }
    // Merge hits that landed on the same lane and tick (keep the louder).
    const seen = new Map<string, Hit>();
    p.hits = p.hits.filter((h) => {
      const k = `${h.art}:${h.tick}`;
      const prev = seen.get(k);
      if (!prev) {
        seen.set(k, h);
        return true;
      }
      prev.vel = Math.max(prev.vel, h.vel);
      return false;
    });
    p.hits.sort((a, b) => a.tick - b.tick);
  });
}

/** The note a hit would have in its pattern's source map (for raw-note lanes and new hits). */
export function noteFor(p: Pattern, art: string) {
  const map = MAP_BY_ID[p.source?.mapId ?? 'kvlt2'] ?? MAP_BY_ID.kvlt2;
  return noteForArt(map, art) ?? ART_BY_ID[art]?.note;
}

/** Articulation for a raw note in a pattern's map. */
export function artForNote(p: Pattern, note: number) {
  const mapId = p.source?.mapId ?? 'kvlt2';
  const map = MAP_BY_ID[mapId] ?? MAP_BY_ID.kvlt2;
  return resolveNote(map, note, useApp.getState().mapping.overrides[mapId]);
}

export function setPatternLength(patternId: string, lengthTicks: number) {
  updatePattern(patternId, (p) => {
    p.lengthTicks = lengthTicks;
  });
}
