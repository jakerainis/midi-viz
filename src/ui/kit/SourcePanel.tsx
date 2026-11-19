/** Where the loaded kit comes from (credits and licence) and what's in it; the choke groups every kit shares. */
import type { LoadedKit } from '../../audio/kit';
import type { Articulation } from '../../model/kit';
import { useApp } from '../../state/store';
import { chokeRules, formatDuration, sampleCount } from './kitInfo';
import styles from './Kit.module.css';

const CHOKES = chokeRules();

export function SourcePanel({ kit, art }: { kit: LoadedKit | null; art: Articulation }) {
  const st = useApp((s) => s.kit);
  const entry = kit && st.available.find((k) => k.id === kit.id);
  const about = kit?.manifest.about;
  const src = kit?.manifest.source;
  const layers = kit?.layers.get(art.id) ?? [];
  const rr = layers.reduce((m, l) => Math.max(m, l.buffers.length), 0);
  const made = src?.renderedAt ? new Date(src.renderedAt) : null;
  const madeWith = [src?.plugin && `${src.plugin}${src.pluginVersion ? ` ${src.pluginVersion}` : ''}`, src?.set, src?.preset].filter(Boolean).join(' · ');

  return (
    <>
      <div className={styles.block}>
        <span className="eyebrow">{entry ? 'Built-in kit' : 'Kit'}</span>
        <span className={styles.sourceTitle}>{kit ? kit.name : 'No kit loaded'}</span>
        {about?.description && <span className={styles.p}>{about.description}</span>}
      </div>

      {kit && (about?.credit || about?.license || about?.url) && (
        <div className={styles.credits}>
          {about.credit && <span>{about.credit}</span>}
          {about.license && (
            <span>
              Licence:{' '}
              {about.licenseUrl ? (
                <a href={about.licenseUrl} target="_blank" rel="noreferrer">
                  {about.license}
                </a>
              ) : (
                about.license
              )}
            </span>
          )}
          {about.url && (
            <a href={about.url} target="_blank" rel="noreferrer" className={styles.path}>
              {about.url.replace(/^https?:\/\//, '')}
            </a>
          )}
          {about.changes && <span className={styles.changes}>Changed for this app: {about.changes}</span>}
        </div>
      )}

      {kit && (
        <dl className={styles.facts}>
          {madeWith && (
            <>
              <dt>Made with</dt>
              <dd>{madeWith}</dd>
            </>
          )}
          {made && !Number.isNaN(made.getTime()) && (
            <>
              <dt>Made</dt>
              <dd>{made.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            </>
          )}
          <dt>Audio</dt>
          <dd>
            {sampleCount(kit).toLocaleString()} samples · {formatDuration(st.seconds || kit.seconds)}
          </dd>
          <dt>Sample rate</dt>
          <dd>{(kit.manifest.sampleRate / 1000).toLocaleString()} kHz</dd>
          <dt>{art.name}</dt>
          <dd>{layers.length ? `${layers.length} velocity layer${layers.length > 1 ? 's' : ''} × ${rr} round-robin${rr > 1 ? 's' : ''}` : 'no samples'}</dd>
          <dt>Stored</dt>
          <dd className={entry ? styles.path : undefined}>{entry ? `/kits/${entry.path}` : '—'}</dd>
        </dl>
      )}

      {!!about?.notes?.length && (
        <details className={styles.details}>
          <summary>How this kit maps onto the app's drums</summary>
          <ul>
            {about.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

    </>
  );
}

/** Choke behaviour, the same for every kit. */
export function ChokeGroups() {
  return (
    <div className={styles.block}>
      <span className="eyebrow">Choke groups</span>
      {CHOKES.map((c) => (
        <div key={c.name} className={styles.choke}>
          <span className={styles.chokeName}>{c.name}</span>
          <span className={styles.chokeRule}>{c.rule}</span>
        </div>
      ))}
      <span className={styles.p}>Every other drum rings out over the next hit.</span>
    </div>
  );
}
