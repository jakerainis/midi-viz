import { useState } from 'react';
import { setOverlay } from '../../state/store';
import * as I from '../icons';
import styles from './Shortcuts.module.css';

const s = (label: string, ...keys: string[]) => ({ label, keys });

/** Mirrors useShortcuts.ts. Keep the two in step. */
const GROUPS = [
  {
    name: 'Transport',
    color: 'var(--accent)',
    items: [
      s('Play / stop', 'Space'),
      s('Play from selection', '⇧', 'Space'),
      s('Return to start', 'Home'),
      s('Loop on / off (Line tool in the clip editor)', 'L'),
      s('Loop the selection', '⌘', 'L'),
      s('Click', 'C'),
    ],
  },
  {
    name: 'Navigate',
    color: '#8EC3FF',
    items: [
      s('Playhead by bar', '←', '→'),
      s('Playhead by beat', '⇧', '← →'),
      s('Previous / next section', '⌥', '← →'),
      s('Zoom out / in', '−', '='),
      s('Zoom at pointer', '⌘', 'scroll'),
      s('Track height', '⇧', '− ='),
      s('Fit song / clip', 'F'),
      s('Zoom to selection', 'Z'),
    ],
  },
  {
    name: 'Views',
    color: '#7FD8B0',
    items: [s('Show / hide the clip editor', 'Tab'), s('Arrange · Kit · Mapping', '1–3'), s('Show shortcuts', '?'), s('Focus library search', '/'), s('Close / clear selection', 'Esc')],
  },
  {
    name: 'Arrange',
    color: '#D9A3FF',
    items: [
      s('Pointer · Pencil tool', 'V', 'B'),
      s('Copy while dragging', '⌥', 'drag'),
      s('Duplicate after', '⌘', 'D'),
      s('Linked copy', '⇧', '⌘', 'D'),
      s('One pass more / less', 'R', '⇧R'),
      s('New empty riff at the playhead', 'N'),
      s('Draw a new riff', 'B', 'drag'),
      s('Split at playhead', 'S'),
      s('Join clips', '⌘', 'J'),
      s('Make unique', '⌘', 'U'),
      s('Add section marker', '⇧', 'M'),
      s('Delete clips / section', '⌫'),
    ],
  },
  {
    name: 'Clip editor (click it first)',
    color: '#FFB36B',
    items: [
      s('Select · Draw · Erase · Line', 'V', 'B E L'),
      s('Quantize', 'Q'),
      s('Velocity −8 / +8', '[', ']'),
      s('Velocity −1 / +1', '⇧', '[ ]'),
      s('Move to lane above / below', '⌥', '↑ ↓'),
      s('Nudge by grid (⇧ by 1 tick)', '← →'),
      s('Select all', '⌘', 'A'),
      s('Hide empty lanes', 'H'),
      s('Delete hits', '⌫'),
    ],
  },
  {
    name: 'Library & file',
    color: 'var(--text-2)',
    items: [
      s('Browse riffs', '↑', '↓'),
      s('Preview riff', 'P'),
      s('Insert at playhead', '↩'),
      s('Replace selected clip', '⌥', '↩'),
      s('Export', '⌘', 'E'),
      s('Undo / redo', '⌘Z', '⇧⌘Z'),
    ],
  },
];

export function ShortcutsOverlay() {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => words.every((w) => `${g.name} ${i.label} ${i.keys.join(' ')}`.toLowerCase().includes(w))) })).filter((g) => g.items.length);
  return (
    <div className={styles.scrim} onPointerDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby="keys-title" className={styles.dialog}>
        <div className={styles.head}>
          <h1 id="keys-title">Keyboard shortcuts</h1>
          <label className={styles.search}>
            <I.Search style={{ color: 'var(--muted)' }} />
            <span className="sr-only">Filter shortcuts</span>
            <input type="search" placeholder="Find a command" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div style={{ flex: 1 }} />
          <span className={styles.tip}>
            Press <kbd>?</kbd> anywhere
          </span>
          <button className="icon-btn" aria-label="Close" onClick={() => setOverlay(null)}>
            <I.Close />
          </button>
        </div>
        <div className={styles.grid}>
          {groups.map((g) => (
            <section key={g.name} className={styles.group}>
              <h2 style={{ color: g.color }}>{g.name}</h2>
              {g.items.map((i) => (
                <div key={i.label} className={styles.item}>
                  <span>{i.label}</span>
                  <span className={styles.keys}>
                    {i.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
