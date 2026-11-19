/**
 * Renders a plan to audio offline with the loaded kit, through the same voice logic and master chain as live
 * playback (audio/voices.ts). Round-robins use a seeded RNG so the same export renders the same samples.
 */
import type { LoadedKit } from '../audio/kit';
import { VoicePlayer, dbToGain, masterChain } from '../audio/voices';
import { TempoMap } from '../model/timing';
import type { Track } from '../model/types';
import { hash32, mulberry32 } from './plan';
import type { Plan } from './plan';

/** Room for the last cymbals to ring out. */
export const TAIL_SEC = 2;

export interface RenderOptions {
  tracks: Track[];
  masterDb: number;
  /** prefs.velCurve: 1 = linear, <1 = louder soft hits, >1 = more dynamic. */
  velCurve: number;
  /** Seeds the round-robin choice. */
  seed: string;
}

function* buffersOf(kit: LoadedKit) {
  for (const layers of kit.layers.values()) for (const l of layers) yield* l.buffers;
}

/** The kit's own sample rate (from its manifest), else the rate its buffers were decoded at. */
export function kitSampleRate(kit: LoadedKit) {
  if (kit.manifest?.sampleRate) return kit.manifest.sampleRate;
  for (const b of buffersOf(kit)) return b.sampleRate;
  return 48000;
}

function kitChannels(kit: LoadedKit) {
  let ch = 1;
  for (const b of buffersOf(kit)) if (b.numberOfChannels > ch) ch = b.numberOfChannels;
  return Math.min(2, ch);
}

/** Length of the rendered file in seconds, tail included. */
export function renderSeconds(plan: Plan) {
  return new TempoMap(plan.tempo).seconds(plan.lengthTicks) + TAIL_SEC;
}

export async function renderPlan(plan: Plan, kit: LoadedKit, opts: RenderOptions): Promise<AudioBuffer> {
  const sampleRate = kitSampleRate(kit);
  const tempo = new TempoMap(plan.tempo);
  const length = Math.max(1, Math.ceil(renderSeconds(plan) * sampleRate));
  const ctx = new OfflineAudioContext({ numberOfChannels: kitChannels(kit), length, sampleRate });

  const master = masterChain(ctx, opts.masterDb);
  const trackGains = new Map<string, GainNode>();
  for (const t of opts.tracks) {
    const g = ctx.createGain();
    g.gain.value = dbToGain(t.volumeDb);
    g.connect(master);
    trackGains.set(t.id, g);
  }

  const player = new VoicePlayer(ctx, mulberry32(hash32(opts.seed)));
  player.setKit(kit);
  player.velCurve = opts.velCurve;
  const hits = plan.events
    .map((ev) => ({ ev, when: Math.max(0, tempo.seconds(ev.tick) + ev.offsetSec) }))
    .sort((a, b) => a.when - b.when);
  for (const { ev, when } of hits) player.trigger(ev.art, ev.vel, when, trackGains.get(ev.trackId) ?? master);

  return ctx.startRendering();
}

/** The channels of a rendered buffer, for encodeWav. */
export const channelsOf = (buf: AudioBuffer) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
