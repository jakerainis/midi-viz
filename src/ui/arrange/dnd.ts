/** Drag data for riffs dragged from the library onto the timeline. */
import type { DragEvent } from 'react';
import { fetchRaw } from '../../state/riffs';

export const RIFF_MIME = 'application/x-midiviz-riff';
export const PATTERN_MIME = 'application/x-midiviz-pattern';

/** What is being dragged right now; HTML drag events can't read dataTransfer until drop. */
export const drag: { key: string | null; patternId: string | null; lengthTicks: number | null } = {
  key: null,
  patternId: null,
  lengthTicks: null,
};

export function startRiffDrag(e: DragEvent, key: string) {
  e.dataTransfer.setData(RIFF_MIME, key);
  e.dataTransfer.setData('text/plain', key);
  e.dataTransfer.effectAllowed = 'copy';
  drag.key = key;
  drag.patternId = null;
  drag.lengthTicks = null;
  void fetchRaw(key).then((raw) => {
    if (drag.key === key) drag.lengthTicks = raw.lengthTicks;
  });
}

export function startPatternDrag(e: DragEvent, patternId: string, lengthTicks: number) {
  e.dataTransfer.setData(PATTERN_MIME, patternId);
  e.dataTransfer.effectAllowed = 'copy';
  drag.key = null;
  drag.patternId = patternId;
  drag.lengthTicks = lengthTicks;
}

export function endDrag() {
  drag.key = null;
  drag.patternId = null;
  drag.lengthTicks = null;
}

export const isOurDrag = (e: DragEvent) =>
  e.dataTransfer.types.includes(RIFF_MIME) || e.dataTransfer.types.includes(PATTERN_MIME);
