# CrocellKit (default drum kit)

The samples in this folder come from **CrocellKit** by the DrumGizmo team, licensed under the
[Creative Commons Attribution 4.0 International licence (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

- Kit: the drum kit of Danish metal band Crocell (crocell.dk), sampled in 2017 while the band recorded *Relics*.
- Kit setup: Andreas, drummer of Crocell.
- Mic setup: Jacob Olsen of JBOSound (jbosound.com).
- Sampled, edited and prepared for DrumGizmo by Lars Muldjord.
- Stereo mix (CrocellKit_Stereo_MIX) by Henry Järvinen.
- Source: https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit

## Changes

These files are a modified version of the stereo mix, made by `scripts/build-default-kit.mjs` in this repository:
A subset of hits picked as velocity layers and round-robins, tails trimmed and faded, levels rebalanced per drum, resampled to 44.1 kHz 16-bit FLAC; floor tom 1 also retuned for tom 3. Velocity values in `kit.json` were derived from the measured loudness of each hit.

## Mapping

- Kick alternates hits from the left and right pedals as round-robins.
- The kit has four toms. Tom 3 is floor tom 1 retuned up 2.5 semitones, halfway to rack tom 2, so a fill down five toms still steps down.
- FX cymbal 1 is the second splash. FX cymbal 2 (stack) shares the left china, as the kit has no stack.
- Ride crash plays the kit's third crash (an extra one on the right), as the kit has no crashed-ride samples.
- Crash chokes are real grabbed-crash samples. Not used: the snare rim, rimshot and rest strokes, and two extra hi-hat articulations.

## Licence

You may share and adapt these samples for any purpose, including commercially, as long as you give appropriate
credit, link to the licence, and indicate changes. Full text: https://creativecommons.org/licenses/by/4.0/legalcode

The samples are provided as-is, without warranties of any kind.
