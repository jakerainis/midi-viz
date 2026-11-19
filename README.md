# midi-viz

A drum-MIDI arranger in the browser. Browse the riff library in `public/midi`, hear it through a sampled acoustic kit,
arrange riffs into a song with sections and tempo changes, crop and loop them, write new ones, edit the notes, and
export MIDI or audio.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
```

To host it: `npm run build`, then `npm start` serves `dist/` with plain Node (`PORT`, default 3000). `dist/` is a
static site, so any static host works too.

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests (vitest) |
| `npm run lint` | ESLint |
| `npm run build-kit -- <source folder>` | Rebuild the default drum kit in `public/kits` (see below) |
| `npm run generate-midi-manifest` | Rebuild `public/midi/manifest.json` after adding riffs |

## Drum sounds

The default kit is **CrocellKit**, the kit of Danish metal band Crocell, sampled by the
[DrumGizmo](https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit) team (Lars Muldjord) and mixed to stereo by
Henry Järvinen. It is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): free to use and share,
including in a hosted app, as long as the credit stays. The Kit view shows the credits and licence, and
`public/kits/crocell/ATTRIBUTION.md` lists them with what was changed.

It ships in `public/kits/crocell` (about 20 MB of 44.1 kHz 16-bit FLAC: 7 kick and 8 snare velocity layers with 5–6
round-robins, 5 layers per tom, 6 for the closed hat, 3–4 per cymbal) and loads from `/kits` like any static file.
`public/kits/index.json` lists the built-in kits; the first one is the default. Kick, snare and closed hat load first,
so playback can start while the rest streams in.

To rebuild it from the source (561 MB download, needs ffmpeg):

```sh
curl -LO https://drumgizmo.org/kits/CrocellKit/CrocellKit_Stereo_MIX.rar
mkdir crocell && bsdtar -xf CrocellKit_Stereo_MIX.rar -C crocell
npm run build-kit -- crocell/CrocellKit_Stereo_MIX       # writes public/kits/crocell and checks it
npm run build-kit -- --check                             # only re-check the built kit
```

The script picks velocity layers and round-robins from the recorded hits by loudness, trims tails, balances the drums
against the snare and checks that layers get louder with velocity and that round-robins differ.

## How it fits together

```
src/
  model/    plain TypeScript: song types, tempo/meter maps, note maps, MIDI import, song → events
  audio/    Web Audio engine (look-ahead scheduler in ticks), kit loading, store bridge
  state/    zustand store with undo, song and note edits, riff loading, autosave
  ui/       React views: Arrange (timeline + clip editor), Kit, Mapping, Export, Shortcuts
  export/   MIDI and WAV export
scripts/    build-default-kit.mjs (rebuilds public/kits), note-usage.mjs (library scan for the Mapping view)
server.mjs  serves the production build
```

- **Song model.** A song has a tempo map, a meter map, sections, tracks and clips. A clip is a window onto a pattern
  (a riff): it has a length on the timeline and loops a region of the riff, starting at an offset. Shorter than the
  loop means cropped, longer means repeated; cropped notes are kept. Clips that share a pattern are linked copies. Every
  track plays what's on it; to drop in a fill, crop or split the beat and put the fill in the gap.
- **Note maps.** Packs were written for different drum maps. Each pack gets a map (Ugritone, Ugritone classic from
  `NWOBHM/MAPPING.txt`, Prog Death, General MIDI, KVLT native), and the Mapping view lets you override any note.
- **Playback.** The engine compiles the song into a sorted event list and schedules it 150 ms ahead through the tempo
  map, so tempo changes, loops and seeks stay sample-accurate. Velocity picks the nearest sampled layer and
  round-robins rotate. Hi-hats and cymbal grabs choke.
- **Saving.** The open song and settings autosave to localStorage. Use the project menu to save or open a song file
  (`.midiviz.json`) or import your own MIDI files.

Press `?` in the app for every keyboard shortcut.
