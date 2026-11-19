/**
 * Every keyboard shortcut lives here, so the overlay (ShortcutsOverlay) and the behaviour stay in one place.
 * Keys are ignored while typing in a field.
 */
import { useEffect } from 'react';
import { engine } from '../../audio/engine';
import { GRIDS } from '../../model/timing';
import { PPQ, clipEnd } from '../../model/types';
import { deleteHits, moveHits, noteFor, quantize, setVelocities } from '../../state/editActions';
import {
  addSection,
  deleteClips,
  duplicateClips,
  joinClips,
  makeUnique,
  removeSection,
  newEmptyClip,
  setLoop,
  splitClip,
  stepRepeat,
} from '../../state/songActions';
import { redo, setArrange, setEditor, setOverlay, setView, undo, useApp } from '../../state/store';
import type { TrackHeight, View } from '../../state/store';
import { arrangeApi } from '../arrange/ArrangeView';
import { libraryApi } from '../arrange/Library';
import { editorApi } from '../editor/editorApi';
import { lanesFor } from '../editor/DrumGrid';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

const VIEWS: View[] = ['arrange', 'kit', 'mapping'];
const HEIGHTS: TrackHeight[] = ['S', 'M', 'L'];

/** Song span of the selection: selected clips, else the selected section, else the loop. */
function selectionSpan(): [number, number] | null {
  const { song, selectedClipIds, selectedSectionId, focus, editClipId } = useApp.getState();
  const ids = focus === 'editor' && editClipId ? [editClipId] : selectedClipIds;
  const clips = song.clips.filter((c) => ids.includes(c.id));
  if (clips.length) return [Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => clipEnd(c, song.patterns[c.patternId])))];
  const sec = song.sections.find((s) => s.id === selectedSectionId);
  if (sec) return [sec.start, sec.end];
  return null;
}

function editTarget() {
  const { song, editClipId, selectedHitIds } = useApp.getState();
  const clip = song.clips.find((c) => c.id === editClipId);
  const pattern = clip && song.patterns[clip.patternId];
  return pattern ? { clip: clip!, pattern, sel: selectedHitIds.filter((id) => pattern.hits.some((h) => h.id === id)) } : null;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key;

      if (k === 'Escape') {
        if (st.overlay) setOverlay(null);
        else if (st.selectedHitIds.length) useApp.setState({ selectedHitIds: [] });
        else useApp.setState({ selectedClipIds: [], selectedSectionId: null });
        return;
      }
      if (typing(e.target)) return;
      // Dialogs own the keyboard, apart from closing.
      if (st.overlay) {
        if (k === '?' && st.overlay === 'shortcuts') setOverlay(null);
        return;
      }

      const view = st.view;
      const handled = () => e.preventDefault();

      // ---- everywhere ----
      if (cmd && k.toLowerCase() === 'z') {
        handled();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (cmd && k.toLowerCase() === 'e') {
        handled();
        setOverlay('export');
        return;
      }
      if (cmd && k.toLowerCase() === 'l') {
        handled();
        const span = selectionSpan();
        if (span) setLoop({ start: span[0], end: span[1], on: true }, true);
        return;
      }
      if (k === ' ') {
        handled();
        if (engine.getSnapshot().mode === 'preview') {
          engine.stopPreview();
          return;
        }
        if (e.shiftKey) {
          const span = selectionSpan();
          void engine.play(span ? span[0] : undefined);
        } else engine.toggle();
        return;
      }
      if (k === 'Home') {
        handled();
        engine.seek(0);
        return;
      }
      if (k === '?') {
        handled();
        setOverlay('shortcuts');
        return;
      }
      if (k === 'Tab' && !cmd) {
        handled();
        if (view !== 'arrange') setView('arrange');
        const show = !st.arrange.showDock || view !== 'arrange';
        setArrange({ showDock: show });
        useApp.setState({ focus: show ? 'editor' : 'timeline' });
        return;
      }
      if (!cmd && !e.altKey && /^[1-3]$/.test(k)) {
        handled();
        setView(VIEWS[Number(k) - 1]);
        return;
      }
      if (!cmd && k.toLowerCase() === 'c' && !e.shiftKey) {
        useApp.setState({ metronome: !st.metronome });
        return;
      }
      const inEditor = view === 'arrange' && st.focus === 'editor' && st.arrange.showDock && !!st.editClipId;
      if (!cmd && k.toLowerCase() === 'l' && !inEditor) {
        setLoop({ on: !st.song.loop.on }, true);
        return;
      }

      // Playhead by bar / beat / section (arrange, or edit with nothing selected).
      if ((k === 'ArrowLeft' || k === 'ArrowRight') && !cmd && (!inEditor || !st.selectedHitIds.length)) {
        handled();
        const dir = k === 'ArrowRight' ? 1 : -1;
        const pos = engine.position();
        const m = engine.meter;
        if (e.altKey) {
          const starts = st.song.sections.map((s) => s.start).sort((a, b) => a - b);
          const next = dir > 0 ? starts.find((s) => s > pos + 1) : [...starts].reverse().find((s) => s < pos - PPQ / 8);
          engine.seek(next ?? (dir > 0 ? pos : 0));
        } else if (e.shiftKey) engine.seek(Math.max(0, m.snapBeat(pos, 'round') + (dir * PPQ * 4) / m.meterAt(pos).den));
        else engine.seek(Math.max(0, m.tickOfBar(Math.round(m.barAt(pos)) + dir)));
        return;
      }

      if (inEditor) editKeys(e);
      else if (view === 'arrange') arrangeKeys(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function arrangeKeys(e: KeyboardEvent) {
  const st = useApp.getState();
  const cmd = e.metaKey || e.ctrlKey;
  const k = e.key;
  const sel = st.selectedClipIds;
  const handled = () => e.preventDefault();

  if (k === 'Backspace' || k === 'Delete') {
    handled();
    if (sel.length) deleteClips(sel);
    else if (st.selectedSectionId) {
      removeSection(st.selectedSectionId);
      useApp.setState({ selectedSectionId: null });
    }
    return;
  }
  if (cmd && k.toLowerCase() === 'd') {
    handled();
    duplicateClips(sel, e.shiftKey);
    return;
  }
  if (cmd && k.toLowerCase() === 'j') {
    handled();
    joinClips(sel);
    return;
  }
  if (cmd && k.toLowerCase() === 'u') {
    handled();
    sel.forEach(makeUnique);
    return;
  }
  if (cmd && k.toLowerCase() === 'a') {
    handled();
    useApp.setState({ selectedClipIds: st.song.clips.map((c) => c.id) });
    return;
  }
  if (cmd) return;
  if (k === 'M' && e.shiftKey) {
    handled();
    const id = addSection(engine.position());
    useApp.setState({ selectedSectionId: id });
    return;
  }
  if (k.toLowerCase() === 'r') {
    for (const id of sel) stepRepeat(id, e.shiftKey ? -1 : 1);
    return;
  }
  if (k.toLowerCase() === 'n') {
    // New empty riff at the playhead on the selected track.
    const trackId = st.selectedTrackId ?? st.song.tracks[0]?.id;
    if (trackId) newEmptyClip(trackId, engine.meter.snapBar(engine.position(), 'floor'));
    return;
  }
  if (k.toLowerCase() === 's') {
    const pos = engine.position();
    const targets = sel.length ? sel : st.song.clips.filter((c) => c.trackId === st.selectedTrackId).map((c) => c.id);
    for (const id of targets) {
      const c = st.song.clips.find((x) => x.id === id);
      if (c && pos > c.start && pos < clipEnd(c, st.song.patterns[c.patternId])) splitClip(id, pos);
    }
    return;
  }
  if (k.toLowerCase() === 'v') return setArrange({ tool: 'pointer' });
  if (k.toLowerCase() === 'b') return setArrange({ tool: 'pencil' });
  if (k === '-' || k === '_') {
    handled();
    if (e.shiftKey) stepHeight(-1);
    else arrangeApi.zoomBy(1 / 1.4);
    return;
  }
  if (k === '=' || k === '+') {
    handled();
    if (e.shiftKey) stepHeight(1);
    else arrangeApi.zoomBy(1.4);
    return;
  }
  if (k.toLowerCase() === 'f') return arrangeApi.fit();
  if (k.toLowerCase() === 'z') return arrangeApi.zoomToSelection();
  if (k === '/') {
    handled();
    libraryApi.focusSearch();
    return;
  }
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    handled();
    libraryApi.move(k === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (k.toLowerCase() === 'p') return void libraryApi.preview();
  if (k === 'Enter') {
    handled();
    void (e.altKey ? libraryApi.replace() : libraryApi.insert());
  }
}

function stepHeight(dir: 1 | -1) {
  const cur = useApp.getState().arrange.trackHeight;
  const i = HEIGHTS.indexOf(cur === 'fit' ? 'M' : cur);
  setArrange({ trackHeight: HEIGHTS[Math.max(0, Math.min(HEIGHTS.length - 1, i + dir))] });
}

function editKeys(e: KeyboardEvent) {
  const st = useApp.getState();
  const cmd = e.metaKey || e.ctrlKey;
  const k = e.key;
  const t = editTarget();
  const handled = () => e.preventDefault();
  const gridTicks = GRIDS.find((g) => g.id === st.editor.grid)?.ticks ?? PPQ / 4;

  if (cmd && k.toLowerCase() === 'a' && t) {
    handled();
    useApp.setState({ selectedHitIds: t.pattern.hits.map((h) => h.id) });
    return;
  }
  if (cmd) return;
  const tool = { v: 'select', b: 'draw', e: 'erase', l: 'line' }[k.toLowerCase()] as 'select' | 'draw' | 'erase' | 'line' | undefined;
  if (tool && !e.shiftKey && !e.altKey) return setEditor({ tool });
  if (k.toLowerCase() === 'h') {
    const order = ['common', 'used', 'all'] as const;
    return setEditor({ lanesShown: order[(order.indexOf(st.editor.lanesShown) + 1) % order.length] });
  }
  if (k === '-' || k === '_') {
    handled();
    return editorApi.zoomBy(1 / 1.4);
  }
  if (k === '=' || k === '+') {
    handled();
    return editorApi.zoomBy(1.4);
  }
  if (k.toLowerCase() === 'f') return editorApi.fit();
  if (!t) return;
  const { pattern, sel } = t;

  if (k.toLowerCase() === 'q') {
    quantize(pattern.id, gridTicks, sel.length ? sel : null);
    return;
  }
  if (!sel.length) return;
  if (k === 'Backspace' || k === 'Delete') {
    handled();
    deleteHits(pattern.id, sel);
    return;
  }
  if (k === '[' || k === ']' || k === '{' || k === '}') {
    handled();
    const step = (e.shiftKey ? 1 : 8) * (k === ']' || k === '}' ? 1 : -1);
    setVelocities(pattern.id, (h) => h.vel + step, sel);
    return;
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    handled();
    const d = (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : gridTicks);
    moveHits(
      pattern.id,
      pattern.hits.filter((h) => sel.includes(h.id)).map((h) => ({ id: h.id, tick: h.tick + d })),
    );
    return;
  }
  if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey) {
    handled();
    const lanes = lanesFor(pattern, 'kit', 'all').filter((l) => l.art);
    const dir = k === 'ArrowDown' ? 1 : -1;
    moveHits(
      pattern.id,
      pattern.hits
        .filter((h) => sel.includes(h.id))
        .map((h) => {
          const i = lanes.findIndex((l) => l.art === h.art);
          const target = lanes[Math.max(0, Math.min(lanes.length - 1, i + dir))];
          return { id: h.id, tick: h.tick, art: target.art, note: noteFor(pattern, target.art!) };
        }),
    );
  }
}
