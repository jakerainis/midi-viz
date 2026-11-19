/**
 * File names for exports, from a pattern like `{song}-{n}-{section}-{bpm}bpm`. A token with nothing to say (no
 * section number for the whole song, say) drops out together with the separator in front of it.
 */

export const DEFAULT_NAME_PATTERN = '{song}-{n}-{section}-{bpm}bpm';
export const NAME_TOKENS = ['{song}', '{n}', '{section}', '{bpm}', '{bars}'];

export interface NameTokens {
  song: string;
  /** Section number(s), already padded ("02", "02-03"), or empty. */
  n: string;
  /** Section, riff or range name, or empty. */
  section: string;
  bpm: number;
  bars: number;
}

/** Lowercase words joined by dashes; empty stays empty. */
export const slugPart = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** 200 → "200", 172.5 → "172.5", 7.333 → "7.33". */
export const formatNumber = (x: number) => String(Math.round(x * 100) / 100);

const EMPTY = '\u0000';
const SEP = '[-_. ]';

export function fileBaseName(pattern: string, t: NameTokens) {
  const values: Record<string, string> = {
    song: slugPart(t.song),
    n: t.n,
    section: slugPart(t.section),
    bpm: formatNumber(t.bpm),
    bars: formatNumber(t.bars),
  };
  let s = pattern.replace(/\{(\w+)\}/g, (m, key: string) => {
    if (!(key in values)) return m;
    return values[key] || EMPTY;
  });
  // An empty token takes the separator in front of it along.
  s = s.replace(new RegExp(`${SEP}*${EMPTY}`, 'g'), '');
  s = s
    .replace(/[/\\:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(new RegExp(`^${SEP}+|${SEP}+$`, 'g'), '')
    .trim();
  if (s.length > 140) s = s.slice(0, 140);
  return s || slugPart(t.song) || 'export';
}

/** Makes every name unique (case-insensitively, as on macOS) by adding -2, -3 before the extension. */
export function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let out = name;
    for (let i = 2; seen.has(out.toLowerCase()); i++) out = `${base}-${i}${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}
