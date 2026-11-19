/** The riff library in public/midi: packs → families → riffs, parsed from file names. */

export interface Riff {
  /** "Grindcore/200bpmOneArmBlast2.mid" – unique key and URL path under /midi. */
  key: string;
  pack: string;
  file: string;
  name: string;
  family: string;
  bpm?: number;
  index?: number;
  isFill: boolean;
}

export interface Family {
  name: string;
  bpm?: number;
  riffs: Riff[];
}

export interface Pack {
  name: string;
  families: Family[];
  count: number;
}

export type Manifest = Record<string, string[]>;

export function parseRiffName(pack: string, file: string): Riff {
  const base = file.replace(/\.midi?$/i, '');
  const bpmMatch = base.match(/^(\d+(?:\.\d+)?)\s*bpm\s*[-_ ]*/i);
  const bpm = bpmMatch ? Number(bpmMatch[1]) : undefined;
  const rest = bpmMatch ? base.slice(bpmMatch[0].length) : base;
  const idxMatch = rest.match(/[\s_-]*(\d+)$/);
  const index = idxMatch ? Number(idxMatch[1]) : undefined;
  let family = (idxMatch ? rest.slice(0, rest.length - idxMatch[0].length) : rest).trim();
  const isFill = !family || /^fills?\b|fill\d|fill$/i.test(family) || (!bpm && /^\d+$/.test(rest));
  if (!family || (!bpm && isFill)) family = 'Fills';
  const name = rest.trim() || base;
  return { key: `${pack}/${file}`, pack, file, name: isFill && !bpm && /^\d+$/.test(name) ? `Fill ${name}` : name, family, bpm, index, isFill };
}

const byNatural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function buildLibrary(manifest: Manifest): Pack[] {
  return Object.entries(manifest)
    .map(([packName, files]) => {
      const fams = new Map<string, Riff[]>();
      for (const f of files) {
        const r = parseRiffName(packName, f);
        if (!fams.has(r.family)) fams.set(r.family, []);
        fams.get(r.family)!.push(r);
      }
      const families: Family[] = [...fams.entries()].map(([name, riffs]) => {
        riffs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || byNatural.compare(a.name, b.name));
        const bpms = new Set(riffs.map((r) => r.bpm).filter(Boolean));
        return { name, riffs, bpm: bpms.size === 1 ? riffs[0].bpm : undefined };
      });
      // Fills last, the rest alphabetically.
      families.sort((a, b) => Number(a.name === 'Fills') - Number(b.name === 'Fills') || byNatural.compare(a.name, b.name));
      return { name: packName.trim(), families, count: files.length };
    })
    .sort((a, b) => byNatural.compare(a.name, b.name));
}

export const riffUrl = (key: string) => `/midi/${key.split('/').map(encodeURIComponent).join('/')}`;
