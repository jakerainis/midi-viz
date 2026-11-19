/** Offers to re-read the song's clips after mapping edits, so the arrangement plays what the maps now say. */
import { useEffect, useState } from 'react';
import { clipsUsing, planRemap, remapPatterns } from '../../state/mappingActions';
import type { RemapPlan } from '../../state/mappingActions';
import { useApp } from '../../state/store';
import * as I from '../icons';
import styles from './Mapping.module.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function RemapBanner() {
  const song = useApp((s) => s.song);
  const mapping = useApp((s) => s.mapping);
  const [plan, setPlan] = useState<RemapPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void planRemap(song, mapping).then((p) => {
      if (live) setPlan(p);
    });
    return () => {
      live = false;
    };
  }, [song, mapping]);

  if (!plan) return null;
  const fresh = clipsUsing(song, plan.fresh);
  const edited = clipsUsing(song, plan.edited);
  const imported = clipsUsing(song, plan.imported);
  if (!fresh && !edited && !imported) {
    return done !== null ? (
      <div className={styles.banner} data-tone="ok" role="status">
        <I.Check style={{ color: 'var(--ok)' }} />
        <span>Re-mapped {plural(done, 'clip')}. Every clip in the song now follows the current maps; ⌘Z undoes it.</span>
      </div>
    ) : null;
  }

  const skipped = [
    edited ? `${plural(edited, 'edited clip')} keep${edited === 1 ? 's' : ''} ${edited === 1 ? 'its' : 'their'} notes (Revert to file in Arrange re-reads one, dropping its edits)` : '',
    imported ? `${plural(imported, 'imported clip')} can't be re-read because ${imported === 1 ? 'its file is' : 'their files are'} not in the library` : '',
  ].filter(Boolean);

  return (
    <div className={styles.banner} role="status">
      <I.Warn style={{ color: 'var(--warn)' }} />
      <div className={styles.bannerText}>
        <span>
          {fresh
            ? `${plural(fresh, 'clip')} in this song ${fresh === 1 ? 'was' : 'were'} read with an older mapping.`
            : done !== null
              ? `Re-mapped ${plural(done, 'clip')}; ⌘Z undoes it.`
              : 'The mapping changed for clips in this song.'}
        </span>
        {skipped.length > 0 && <span className={styles.bannerSub}>{skipped.join('. ')}.</span>}
      </div>
      {fresh > 0 && (
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const ids = await remapPatterns(plan.fresh);
              setDone(clipsUsing(useApp.getState().song, ids));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Re-mapping…' : `Re-map ${plural(fresh, 'clip')} in this song`}
        </button>
      )}
    </div>
  );
}
