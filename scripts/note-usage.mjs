#!/usr/bin/env node
/**
 * Scans the riff library and writes public/midi/note-usage.json: for every pack, how many hits and files use
 * each MIDI note. The Mapping view reads it to show which notes riffs actually use and which have no sound.
 *
 *   npm run note-usage
 *
 * Reads public/midi/manifest.json (pack folder → file names). Pack names are trimmed, as in the app.
 * Notes are counted the way the app reads files (src/model/importMidi.ts): every note on every track.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tonejs from '@tonejs/midi';

const { Midi } = tonejs;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIDI_DIR = path.join(ROOT, 'public', 'midi');
const OUT = path.join(MIDI_DIR, 'note-usage.json');

const manifest = JSON.parse(fs.readFileSync(path.join(MIDI_DIR, 'manifest.json'), 'utf8'));

const packs = {};
let totalFiles = 0;
let totalHits = 0;
const failed = [];

for (const [folder, files] of Object.entries(manifest)) {
  const name = folder.trim();
  const notes = {};
  let read = 0;
  for (const file of files) {
    let midi;
    try {
      midi = new Midi(fs.readFileSync(path.join(MIDI_DIR, folder, file)));
    } catch (err) {
      failed.push(`${folder}/${file}: ${err.message}`);
      continue;
    }
    read++;
    const inFile = new Map();
    for (const track of midi.tracks) for (const n of track.notes) inFile.set(n.midi, (inFile.get(n.midi) ?? 0) + 1);
    for (const [note, hits] of inFile) {
      const e = (notes[note] ??= { hits: 0, files: 0 });
      e.hits += hits;
      e.files += 1;
      totalHits += hits;
    }
  }
  totalFiles += read;
  // Keys in ascending note order.
  const sorted = Object.fromEntries(Object.entries(notes).sort((a, b) => Number(a[0]) - Number(b[0])));
  packs[name] = { files: read, notes: sorted };
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  files: totalFiles,
  hits: totalHits,
  packs,
};

// One pack per line keeps the file small and its diffs readable.
const lines = Object.entries(packs).map(([name, v]) => `  ${JSON.stringify(name)}: ${JSON.stringify(v)}`);
const head = JSON.stringify({ ...out, packs: undefined }).slice(0, -1);
fs.writeFileSync(OUT, `${head},\n "packs": {\n${lines.join(',\n')}\n }\n}\n`);
console.log(`${path.relative(ROOT, OUT)}: ${Object.keys(packs).length} packs, ${totalFiles} files, ${totalHits} hits`);
if (failed.length) {
  console.warn(`${failed.length} file(s) could not be read:`);
  for (const f of failed) console.warn(`  ${f}`);
}
