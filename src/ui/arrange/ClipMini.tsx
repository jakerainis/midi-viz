import { memo } from 'react';
import { ART_BY_ID } from '../../model/kit';
import type { LaneGroup } from '../../model/kit';
import { clipHits } from '../../model/types';
import type { Clip, Pattern } from '../../model/types';

const ROW: Record<LaneGroup, number> = { cymbals: 0, hihat: 1, snare: 2, toms: 3, kick: 4 };
const ROWS = 5;

/**
 * The hits a clip plays as tick marks, one row per drum group (cymbals on top, kick at the bottom). Strokes don't
 * scale with the SVG so the marks stay crisp at any zoom.
 */
export const ClipMini = memo(function ClipMini({ clip, pattern }: { clip: Clip; pattern: Pattern }) {
  const paths: string[][] = [[], [], [], []];
  for (const { tick, hit: h } of clipHits(clip, pattern)) {
    const g = ART_BY_ID[h.art]?.group;
    if (!g) continue;
    const x = tick - clip.start;
    const y = ROW[g];
    paths[h.vel > 112 ? 3 : h.vel > 88 ? 2 : h.vel > 56 ? 1 : 0].push(`M${x} ${y + 0.15}v0.7`);
  }
  const op = [0.35, 0.55, 0.8, 1];
  return (
    <svg className="clip-mini" viewBox={`0 0 ${Math.max(1, clip.length)} ${ROWS}`} preserveAspectRatio="none" aria-hidden="true">
      {paths.map((p, i) =>
        p.length ? <path key={i} d={p.join('')} stroke="var(--clip-tick)" strokeOpacity={op[i]} strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null,
      )}
    </svg>
  );
});

/** A pattern on its own (library preview). */
export const PatternMini = memo(function PatternMini({ pattern }: { pattern: Pattern }) {
  const clip: Clip = { id: '', trackId: '', patternId: pattern.id, start: 0, length: pattern.lengthTicks, loopStart: 0, loopEnd: pattern.lengthTicks, offset: 0 };
  return <ClipMini clip={clip} pattern={pattern} />;
});
