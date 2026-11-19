#!/usr/bin/env node
/**
 * Builds the app's default drum kit (public/kits/crocell) from the CrocellKit stereo mix.
 *
 * CrocellKit is the kit of Danish metal band Crocell, sampled by the DrumGizmo team (Lars Muldjord) and released
 * under CC BY 4.0: https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit. Henry Järvinen made the stereo mix this
 * script reads (close mics, overheads and room mixed to stereo, one WAV per recorded hit).
 *
 *   curl -LO https://drumgizmo.org/kits/CrocellKit/CrocellKit_Stereo_MIX.rar    # 561 MB
 *   mkdir crocell && bsdtar -xf CrocellKit_Stereo_MIX.rar -C crocell            # or: unrar x
 *   npm run build-kit -- crocell/CrocellKit_Stereo_MIX
 *
 * Every hit in the source is a separate recording with its own loudness. For each of the app's articulations the
 * script measures every hit (K-weighted loudness of its first 400 ms, as in EBU R128 / BS.1770), spreads velocity
 * layers across that range and picks the hits closest to each layer as its round-robins. A layer's velocity follows
 * its measured loudness on the engine's velocity curve (gain = (vel / 127)^1.6), so playback between layers stays
 * smooth. Then it trims the lead-in to the onset and cuts the tail where it falls below -66 dBFS (or at a per-drum
 * maximum, with a fade).
 *
 * Levels: no sample is normalised on its own, so dynamics within a drum stay as recorded. Each drum gets one trim
 * so the loudest layers sit in a metal balance against the snare (BALANCE), then one gain for the whole kit puts
 * the snare where other kits in the app sit. Output is 44.1 kHz 16-bit stereo FLAC. Finally the script checks that
 * layers get louder with velocity and that round-robins differ.
 *
 * Options: --out <dir> (default public/kits/crocell), --check (only re-check an existing build).
 * Needs ffmpeg on PATH. Reads only WAV and XML from the source folder; runs nothing from it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const SRC_RATE = 48000;
/** The engine's velocity curve: gain = (vel / 127) ^ CURVE at the default setting (audio/voices.ts). */
const CURVE = 1.6;
/** Loudness window after the onset (momentary loudness). */
const WINDOW_SEC = 0.4;
/** Widest loudness range (dB) among one layer's round-robins, while there are at least two. */
const MAX_SPREAD = 6;
/** Tails end where they fall below this (after gain). */
const FLOOR_DB = -66;
/** The top snare layer lands here (K-weighted, 400 ms), about where other kits in the app sit. */
const SNARE_TARGET = -24.5;

/**
 * Loudest layer of each drum against the top snare, in dB of K-weighted loudness. The stereo mix has a hot kick
 * and crashes and a quiet ride for a metal kit; these targets follow a typical metal kit preset. Articulations in
 * one entry share a trim (measured on their average), so hi-hat or ride articulations keep their recorded relation.
 */
const BALANCE = [
  { arts: ['kick'], target: -2.5 },
  { arts: ['tom1', 'tom2', 'tom3', 'tom4', 'tom5'], target: -1.5 },
  { arts: ['hihat_closed', 'hihat_pedal', 'hihat_semiopen', 'hihat_wideopen'], ref: ['hihat_closed'], target: -10 },
  { arts: ['crash1', 'crash1_choke', 'crash2', 'crash2_choke'], ref: ['crash1', 'crash2'], target: -4 },
  { arts: ['ride_crash'], target: -5 },
  { arts: ['china1', 'china2'], target: -3 },
  { arts: ['splash1', 'fx1'], target: -8 },
  { arts: ['ride_bow', 'ride_bell'], ref: ['ride_bow'], target: -10 },
];

const KIT_ID = 'crocell';

/**
 * Articulation → source instruments. `layers` × `rr` hits are picked (fewer when the source has fewer). `maxSec`
 * caps ringing cymbals; `pitch` retunes in semitones; `from` reuses another articulation's samples.
 */
const ARTS = [
  { id: 'kick', piece: 'kick', note: 36, src: ['KDrumR', 'KDrumL'], layers: 7, rr: 6, maxSec: 0.8 },
  { id: 'snare', piece: 'snare', note: 38, src: ['Snare'], layers: 8, rr: 5, maxSec: 1.1 },
  { id: 'tom1', piece: 'tom1', note: 48, src: ['Tom1'], layers: 5, rr: 3, maxSec: 1.4 },
  { id: 'tom2', piece: 'tom2', note: 47, src: ['Tom2'], layers: 5, rr: 3, maxSec: 1.5 },
  { id: 'tom3', piece: 'tom3', note: 45, src: ['FTom1'], layers: 5, rr: 3, maxSec: 1.6, pitch: 2.5 },
  { id: 'tom4', piece: 'tom4', note: 43, src: ['FTom1'], layers: 5, rr: 3, maxSec: 1.7 },
  { id: 'tom5', piece: 'tom5', note: 41, src: ['FTom2'], layers: 5, rr: 3, maxSec: 1.8 },
  { id: 'hihat_closed', piece: 'hihat', note: 42, src: ['HihatClosed'], layers: 6, rr: 5, maxSec: 0.6 },
  { id: 'hihat_pedal', piece: 'hihat', note: 44, src: ['HihatPedal'], layers: 3, rr: 3, maxSec: 0.6 },
  { id: 'hihat_semiopen', piece: 'hihat', note: 46, src: ['HihatSemiOpen'], layers: 4, rr: 3, maxSec: 1.4 },
  { id: 'hihat_wideopen', piece: 'hihat', note: 32, src: ['HihatOpen'], layers: 4, rr: 3, maxSec: 2.5 },
  { id: 'crash1', piece: 'crash1', note: 49, src: ['CrashL'], layers: 4, rr: 3, maxSec: 4 },
  { id: 'crash1_choke', piece: 'crash1', note: 50, src: ['CrashLStopped'], layers: 3, rr: 2, maxSec: 0.9 },
  { id: 'crash2', piece: 'crash2', note: 57, src: ['CrashR'], layers: 4, rr: 3, maxSec: 4 },
  { id: 'crash2_choke', piece: 'crash2', note: 58, src: ['CrashRStopped'], layers: 3, rr: 2, maxSec: 0.9 },
  { id: 'splash1', piece: 'splash1', note: 55, src: ['SplashL'], layers: 3, rr: 2, maxSec: 1.8 },
  { id: 'fx1', piece: 'fx1', note: 56, src: ['SplashR'], layers: 3, rr: 2, maxSec: 1.8 },
  { id: 'china1', piece: 'china1', note: 52, src: ['ChinaR'], layers: 4, rr: 3, maxSec: 3.5 },
  { id: 'china2', piece: 'china2', note: 61, src: ['ChinaL'], layers: 4, rr: 3, maxSec: 3.2 },
  { id: 'fx2', piece: 'fx2', note: 59, from: 'china2' },
  { id: 'ride_bow', piece: 'ride', note: 51, src: ['RideR'], layers: 4, rr: 3, maxSec: 3.5 },
  { id: 'ride_bell', piece: 'ride', note: 53, src: ['RideRBell'], layers: 3, rr: 3, maxSec: 3.5 },
  { id: 'ride_crash', piece: 'ride', note: 54, src: ['CrashRXtra'], layers: 3, rr: 2, maxSec: 4 },
];

const PIECES = [
  { id: 'kick', sampleName: 'Kick, both pedals' },
  { id: 'snare', sampleName: 'Snare' },
  { id: 'tom1', sampleName: 'Rack tom 1' },
  { id: 'tom2', sampleName: 'Rack tom 2' },
  { id: 'tom3', sampleName: 'Floor tom 1, tuned up' },
  { id: 'tom4', sampleName: 'Floor tom 1' },
  { id: 'tom5', sampleName: 'Floor tom 2' },
  { id: 'hihat', sampleName: 'Hi-hat' },
  { id: 'crash1', sampleName: 'Left crash' },
  { id: 'crash2', sampleName: 'Right crash' },
  { id: 'splash1', sampleName: 'Left splash' },
  { id: 'fx1', sampleName: 'Right splash' },
  { id: 'fx2', sampleName: 'Left china (shared)' },
  { id: 'china1', sampleName: 'Right china' },
  { id: 'china2', sampleName: 'Left china' },
  { id: 'ride', sampleName: 'Ride' },
];

const NOTES = [
  'Kick alternates hits from the left and right pedals as round-robins.',
  'The kit has four toms. Tom 3 is floor tom 1 retuned up 2.5 semitones, halfway to rack tom 2, so a fill down five toms still steps down.',
  'FX cymbal 1 is the second splash. FX cymbal 2 (stack) shares the left china, as the kit has no stack.',
  "Ride crash plays the kit's third crash (an extra one on the right), as the kit has no crashed-ride samples.",
  'Crash chokes are real grabbed-crash samples. Not used: the snare rim, rimshot and rest strokes, and two extra hi-hat articulations.',
];

// ---------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.resolve(opt('--out', path.join(repo, 'public/kits', KIT_ID)));
const srcDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
const fromDb = (d) => Math.pow(10, d / 20);
/** Loudness (dB, relative to the top layer) → velocity on the engine's curve, and back. */
const velForDb = (d) => 127 * Math.pow(fromDb(d), 1 / CURVE);
const dbForVel = (v) => CURVE * db(v / 127);

function run(cmd, argv, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Decodes to interleaved stereo Float32 at 44.1 kHz, optionally retuned (resampled, so the decay follows). */
async function decode(file, pitch = 0) {
  const filters = [];
  if (pitch) filters.push(`asetrate=${Math.round(SRC_RATE * Math.pow(2, pitch / 12))}`);
  filters.push(`aresample=${RATE}:filter_size=64:cutoff=0.97`);
  const buf = await run('ffmpeg', ['-v', 'error', '-i', file, '-af', filters.join(','), '-ac', '2', '-f', 'f32le', '-']);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4).slice();
}

async function encode(samples, file) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', '-', '-c:a', 'flac', '-sample_fmt', 's16', '-compression_level', '8', file], input);
}

/** Minimal reader for DrumGizmo instrument XML: each <sample> and the file holding its Left channel. */
function readInstrument(dir, name) {
  const xml = fs.readFileSync(path.join(dir, name, `${name}.xml`), 'utf8');
  const hits = [];
  for (const m of xml.matchAll(/<sample\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/sample>/g)) {
    const left = /<audiofile\b[^>]*channel="Left"[^>]*file="([^"]+)"[^>]*filechannel="(\d+)"/.exec(m[2]);
    const right = /<audiofile\b[^>]*channel="Right"[^>]*file="([^"]+)"[^>]*filechannel="(\d+)"/.exec(m[2]);
    if (!left || !right || left[1] !== right[1] || left[2] !== '1' || right[2] !== '2') throw new Error(`${name}: ${m[1]} isn't a plain stereo file`);
    const file = path.join(dir, name, left[1]);
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) throw new Error(`${name}: ${left[1]} points outside the kit`);
    hits.push({ instrument: name, name: m[1], file });
  }
  if (!hits.length) throw new Error(`${name}: no samples`);
  return hits;
}

/** BS.1770 K-weighting filters (high shelf, then high-pass) for RATE, as libebur128 derives them. */
const K_FILTERS = (() => {
  let K = Math.tan((Math.PI * 1681.974450955533) / RATE);
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  K = Math.tan((Math.PI * 38.13547087602444) / RATE);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
})();

/** K-weighted loudness (LUFS) of `frames` frames from `from`. */
function loudness(x, from, frames) {
  const end = Math.min(x.length / 2, from + frames);
  let e = 0;
  for (let ch = 0; ch < 2; ch++) {
    const st = K_FILTERS.map(() => [0, 0, 0, 0]);
    for (let i = from; i < end; i++) {
      let v = x[i * 2 + ch];
      K_FILTERS.forEach((f, k) => {
        const s = st[k];
        const y = f.b[0] * v + f.b[1] * s[0] + f.b[2] * s[1] - f.a[0] * s[2] - f.a[1] * s[3];
        s[1] = s[0];
        s[0] = v;
        s[3] = s[2];
        s[2] = y;
        v = y;
      });
      e += v * v;
    }
  }
  return -0.691 + 10 * Math.log10(e / frames + 1e-20);
}

/** Onset, loudness and peak of one hit. */
function measure(x) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const thresh = peak * fromDb(-40);
  let on = 0;
  while (on < x.length && Math.abs(x[on]) < thresh) on++;
  on = Math.max(0, (on >> 1) - Math.round(0.0005 * RATE)); // frames, 0.5 ms before the onset
  return { onset: on, rms: loudness(x, on, Math.round(WINDOW_SEC * RATE)), peak: db(peak) };
}

/**
 * Spreads `layers` targets evenly in velocity between the quiet end (5th percentile, so a stray ghost note doesn't
 * set it) and the loudest hits, then gives each target the run of `rr` neighbouring hits (in loudness order) that
 * sits closest to it and spreads least. Loudest layer first. With several sources (the kick's two pedals) each
 * layer takes its share from each, so round-robins alternate between them.
 */
function pickLayers(hits, layers, rr, sources) {
  const sorted = hits.slice().sort((a, b) => a.m.rms - b.m.rms);
  while (layers * rr > sorted.length && rr > 2) rr--;
  while (layers * rr > sorted.length && layers > 1) layers--;
  rr = Math.min(rr, Math.floor(sorted.length / layers));
  const top = sorted.slice(-rr).reduce((s, h) => s + h.m.rms, 0) / rr;
  const low = sorted[Math.floor(sorted.length * 0.05)].m.rms;
  const vMin = Math.max(8, velForDb(low - top));
  const groups = sources.map((src) => sorted.filter((h) => h.instrument === src));
  const used = new Set();
  const out = [];
  for (let j = layers - 1; j >= 0; j--) {
    const v = layers === 1 ? 127 : vMin + ((127 - vMin) * j) / (layers - 1);
    const target = top + dbForVel(v);
    const pick = [];
    groups.forEach((g, gi) => {
      const free = g.filter((h) => !used.has(h));
      // Where hits are sparse (usually the soft end), take fewer round-robins rather than blend unlike hits.
      const full = Math.floor(rr / groups.length) + (gi < rr % groups.length ? 1 : 0);
      const least = Math.min(2, full);
      let best = null;
      for (let share = full; share >= least; share--) {
        for (let i = 0; i + share <= free.length; i++) {
          const run = free.slice(i, i + share);
          const spread = run[share - 1].m.rms - run[0].m.rms;
          if (spread > MAX_SPREAD && share > least) continue;
          const mean = run.reduce((s, h) => s + h.m.rms, 0) / share;
          // Distance to the target, plus half the spread, plus 1 dB per round-robin given up.
          const score = Math.abs(mean - target) + 0.5 * spread + (full - share);
          if (!best || score < best.score) best = { run, score };
        }
      }
      for (const h of best?.run ?? []) {
        used.add(h);
        pick.push(h);
      }
    });
    // Alternate sources within the layer: R, L, R, L…
    pick.sort((a, b) => sources.indexOf(a.instrument) - sources.indexOf(b.instrument));
    const order = [];
    for (let k = 0; order.length < pick.length; k++) for (const src of sources) {
      const of = pick.filter((h) => h.instrument === src);
      if (of[k]) order.push(of[k]);
    }
    const mean = order.reduce((s, h) => s + h.m.rms, 0) / order.length;
    out.unshift({ hits: order, rms: mean, velocity: Math.max(1, Math.min(127, Math.round(velForDb(mean - top)))) });
  }
  out.sort((x, y) => x.rms - y.rms);
  // Velocities must rise strictly.
  for (let j = out.length - 2; j >= 0; j--) out[j].velocity = Math.min(out[j].velocity, out[j + 1].velocity - 1);
  out[out.length - 1].velocity = 127;
  return out;
}

/** Start at the onset; end where the level stays under the floor, or at maxSec with a long fade. */
function trim(x, onset, gainDb, maxSec) {
  const frames = x.length / 2;
  const block = 256;
  const floor = fromDb(FLOOR_DB - gainDb);
  let end = onset;
  for (let b = onset; b < frames; b += block) {
    let m = 0;
    for (let i = b * 2; i < Math.min(frames, b + block) * 2; i++) m = Math.max(m, Math.abs(x[i]));
    if (m > floor) end = Math.min(frames, b + block);
  }
  const cap = onset + Math.round(maxSec * RATE);
  const capped = end > cap;
  if (capped) end = cap;
  const len = end - onset;
  const out = new Float32Array(len * 2);
  const g = fromDb(gainDb);
  const fade = capped ? Math.round(len * 0.45) : Math.min(len, Math.round(0.04 * RATE));
  for (let i = 0; i < len; i++) {
    const t = len - i <= fade ? (len - i) / fade : 1;
    const f = capped ? t * t : 0.5 - 0.5 * Math.cos(Math.PI * t);
    out[i * 2] = x[(onset + i) * 2] * g * f;
    out[i * 2 + 1] = x[(onset + i) * 2 + 1] * g * f;
  }
  return { audio: out, capped };
}

/**
 * How different two hits sound: 1 − correlation of their first 100 ms after a first-difference filter (which
 * weights the stick and beater attack over the low thump, where one kick hit looks much like the next). 0 means
 * identical, near 1 unrelated.
 */
function difference(a, b) {
  const n = Math.min(a.length, b.length, Math.round(0.1 * RATE) * 2);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 2; i < n; i++) {
    const da = a[i] - a[i - 2];
    const dB = b[i] - b[i - 2];
    ab += da * dB;
    aa += da * da;
    bb += dB * dB;
  }
  return 1 - ab / Math.sqrt(aa * bb + 1e-30);
}

const hashOf = (x) => createHash('sha1').update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest('hex');

async function check(dir) {
  const kit = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8'));
  let ok = true;
  let bytes = 0;
  let seconds = 0;
  const seen = new Set();
  const hashes = new Map();
  const tops = [];
  console.log('\narticulation     layers x rr   velocity:loudness (LUFS, 400 ms; loudness and peak must rise)  RR difference (min)');
  for (const a of kit.articulations) {
    const rows = [];
    let minDiff = 1;
    for (const l of a.layers) {
      const decoded = [];
      for (const f of l.files) {
        const x = await decode(path.join(dir, f));
        decoded.push(x);
        const h = hashOf(x);
        if (hashes.has(h) && hashes.get(h) !== f) {
          console.log(`identical audio: ${f} and ${hashes.get(h)}`);
          ok = false;
        }
        hashes.set(h, f);
        if (!seen.has(f)) {
          seen.add(f);
          bytes += fs.statSync(path.join(dir, f)).size;
          seconds += x.length / 2 / RATE;
        }
      }
      const r = decoded.reduce((s, x) => s + loudness(x, 0, Math.round(WINDOW_SEC * RATE)), 0) / decoded.length;
      const pk = decoded.reduce((s, x) => s + measure(x).peak, 0) / decoded.length;
      rows.push({ v: l.velocity, r, pk });
      for (let i = 0; i < decoded.length; i++) for (let j = i + 1; j < decoded.length; j++) minDiff = Math.min(minDiff, difference(decoded[i], decoded[j]));
    }
    const rising = rows.every((x, i) => i === 0 || (x.r > rows[i - 1].r && x.pk > rows[i - 1].pk));
    tops.push({ id: a.id, r: rows.at(-1).r, pk: rows.at(-1).pk });
    const rrOk = a.layers.every((l) => l.files.length < 2) || minDiff > 0.02;
    if (!rising || !rrOk) ok = false;
    const shape = `${a.layers.length} x ${Math.max(...a.layers.map((l) => l.files.length))}`;
    const from = a.from ? ` (= ${a.from})` : '';
    console.log(
      `${(a.id + from).padEnd(17)}${shape.padEnd(14)}${rows.map((x) => `${x.v}:${x.r.toFixed(1)}`).join(' ').padEnd(50)} ${rising ? 'rising' : 'NOT RISING'}  ${a.layers.some((l) => l.files.length > 1) ? minDiff.toFixed(3) : '-'}${rrOk ? '' : ' SAME'}`,
    );
  }
  const snare = tops.find((t) => t.id === 'snare');
  console.log('\nTop layers against the snare (dB):  ' + tops.map((t) => `${t.id} ${(t.r - snare.r).toFixed(1)}`).join(', '));
  console.log(`Snare top layer ${snare.r.toFixed(1)} LUFS; loudest peak ${Math.max(...tops.map((t) => t.pk)).toFixed(1)} dBFS (layer average)`);
  for (const f of fs.readdirSync(dir, { recursive: true })) if (/\.flac$/.test(f) && !seen.has(f.split(path.sep).join('/'))) console.log(`unused file: ${f}`);
  console.log(`\n${seen.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${seconds.toFixed(0)} s of audio. ${ok ? 'All checks pass.' : 'CHECKS FAILED.'}`);
  return ok;
}

async function build() {
  if (!srcDir) throw new Error('Usage: npm run build-kit -- <path to CrocellKit_Stereo_MIX> [--out dir]');
  const src = path.resolve(srcDir);
  if (!fs.existsSync(path.join(src, 'CrocellKit_full.xml'))) throw new Error(`${src} doesn't look like the CrocellKit stereo mix (no CrocellKit_full.xml).`);

  // 1. Measure every hit and pick layers.
  const plan = [];
  for (const a of ARTS) {
    if (a.from) continue;
    const hits = a.src.flatMap((name) => readInstrument(src, name));
    for (const h of hits) {
      h.x = await decode(h.file, a.pitch);
      h.m = measure(h.x);
    }
    const layers = pickLayers(hits, a.layers, a.rr, a.src);
    const keep = new Set(layers.flatMap((l) => l.hits));
    for (const h of hits) if (!keep.has(h)) h.x = null;
    plan.push({ a, layers, all: hits.length });
    const spread = Math.max(...layers.map((l) => Math.max(...l.hits.map((h) => h.m.rms)) - Math.min(...l.hits.map((h) => h.m.rms))));
    console.log(`${a.id.padEnd(16)} ${String(hits.length).padStart(3)} hits -> ${layers.length} layers, widest ${spread.toFixed(1)} dB: ${layers.map((l) => `${l.velocity}@${l.rms.toFixed(1)}x${l.hits.length}`).join(' ')}`);
  }

  // 2. Balance: one trim per drum against the snare, then one gain for the whole kit.
  const top = (id) => plan.find((p) => p.a.id === id).layers.at(-1).rms;
  const snareTop = top('snare');
  const kitGain = SNARE_TARGET - snareTop;
  for (const p of plan) p.gain = kitGain;
  for (const b of BALANCE) {
    const ref = b.ref ?? b.arts;
    const measured = ref.reduce((s, id) => s + top(id), 0) / ref.length - snareTop;
    const trimDb = b.target - measured;
    for (const p of plan) if (b.arts.includes(p.a.id)) p.gain = kitGain + trimDb;
    console.log(`${b.arts.join(', ').padEnd(56)} was ${measured.toFixed(1).padStart(5)} dB vs snare, trim ${trimDb.toFixed(1).padStart(5)} dB`);
  }
  let maxPeak = -200;
  for (const p of plan) for (const l of p.layers) for (const h of l.hits) maxPeak = Math.max(maxPeak, h.m.peak + p.gain);
  console.log(`Kit gain ${kitGain.toFixed(1)} dB; loudest sample peak ${maxPeak.toFixed(1)} dBFS`);
  if (maxPeak > -1) throw new Error('A sample would clip; lower SNARE_TARGET.');

  // 3. Write.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const articulations = [];
  for (const p of plan) {
    fs.mkdirSync(path.join(outDir, p.a.id));
    const layers = [];
    let capped = 0;
    for (const l of p.layers) {
      const files = [];
      for (const [i, h] of l.hits.entries()) {
        const t = trim(h.x, h.m.onset, p.gain, p.a.maxSec);
        if (t.capped) capped++;
        const rel = `${p.a.id}/v${String(l.velocity).padStart(3, '0')}-rr${i + 1}.flac`;
        await encode(t.audio, path.join(outDir, rel));
        files.push(rel);
      }
      layers.push({ velocity: l.velocity, files });
    }
    articulations.push({ id: p.a.id, piece: p.a.piece, note: p.a.note, layers });
    if (capped) console.log(`${p.a.id}: ${capped} tails shortened to ${p.a.maxSec} s with a fade`);
  }
  for (const a of ARTS.filter((x) => x.from)) {
    const of = articulations.find((x) => x.id === a.from);
    articulations.push({ id: a.id, piece: a.piece, note: a.note, from: a.from, layers: of.layers });
  }
  const order = ARTS.map((a) => a.id);
  articulations.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const manifest = {
    version: 1,
    id: KIT_ID,
    name: 'CrocellKit',
    about: {
      description:
        'The kit of Danish metal band Crocell, sampled while they recorded their 2018 album Relics. A stereo mix of close mics, overheads and room.',
      credit:
        'CrocellKit by the DrumGizmo team: sampled and prepared by Lars Muldjord, kit setup by Andreas of Crocell, mic setup by Jacob Olsen (JBOSound). Stereo mix by Henry Järvinen.',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      url: 'https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit',
      changes:
        'A subset of hits picked as velocity layers and round-robins, tails trimmed and faded, levels rebalanced per drum, resampled to 44.1 kHz 16-bit FLAC; floor tom 1 also retuned for tom 3.',
      notes: NOTES,
    },
    sampleRate: RATE,
    pieces: PIECES,
    articulations,
  };
  fs.writeFileSync(path.join(outDir, 'kit.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION.md'), attribution(manifest));
  writeIndex();
}

function attribution(m) {
  return `# CrocellKit (default drum kit)

The samples in this folder come from **CrocellKit** by the DrumGizmo team, licensed under the
[Creative Commons Attribution 4.0 International licence (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

- Kit: the drum kit of Danish metal band Crocell (crocell.dk), sampled in 2017 while the band recorded *Relics*.
- Kit setup: Andreas, drummer of Crocell.
- Mic setup: Jacob Olsen of JBOSound (jbosound.com).
- Sampled, edited and prepared for DrumGizmo by Lars Muldjord.
- Stereo mix (CrocellKit_Stereo_MIX) by Henry Järvinen.
- Source: ${m.about.url}

## Changes

These files are a modified version of the stereo mix, made by \`scripts/build-default-kit.mjs\` in this repository:
${m.about.changes} Velocity values in \`kit.json\` were derived from the measured loudness of each hit.

## Mapping

${m.about.notes.map((n) => `- ${n}`).join('\n')}

## Licence

You may share and adapt these samples for any purpose, including commercially, as long as you give appropriate
credit, link to the licence, and indicate changes. Full text: https://creativecommons.org/licenses/by/4.0/legalcode

The samples are provided as-is, without warranties of any kind.
`;
}

function writeIndex() {
  const file = path.join(repo, 'public/kits/index.json');
  const index = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { kits: [] };
  const entry = { id: KIT_ID, name: 'CrocellKit', path: `${path.relative(path.join(repo, 'public/kits'), outDir).split(path.sep).join('/')}/kit.json` };
  index.kits = [entry, ...index.kits.filter((k) => k.id !== KIT_ID)];
  fs.writeFileSync(file, JSON.stringify(index, null, 2) + '\n');
}

try {
  if (!flag('--check')) await build();
  const ok = await check(outDir);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err.message ?? err);
  process.exit(1);
}
