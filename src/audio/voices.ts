/**
 * How one drum hit becomes sound: pick the nearest velocity layer, rotate round-robins without repeating, scale the
 * level by the velocity curve, cut off choke groups, and cap the number of voices. Shared by live playback
 * (engine.ts) and the offline audio export (export/render.ts), so both sound the same.
 */
import { ART_BY_ID } from '../model/kit';
import type { LoadedKit } from './kit';

export const MAX_VOICES = 96;
/** Headroom on the master bus before the limiter. */
const MASTER_TRIM = 0.8;

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

/** Master level → limiter → destination. Returns the level node to connect into. */
export function masterChain(ctx: BaseAudioContext, db = 0) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  const master = ctx.createGain();
  master.gain.value = dbToGain(db) * MASTER_TRIM;
  master.connect(limiter).connect(ctx.destination);
  return master;
}

export function setMasterLevel(master: GainNode, db: number, ctx: BaseAudioContext) {
  master.gain.setTargetAtTime(dbToGain(db) * MASTER_TRIM, ctx.currentTime, 0.02);
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  chokeGroup?: string;
}

export class VoicePlayer {
  kit: LoadedKit | null = null;
  /** Velocity curve exponent: 1 = linear, <1 = louder soft hits, >1 = more dynamic. */
  velCurve = 1;
  private voices: Voice[] = [];
  private rrLast = new Map<string, number>();
  private readonly ctx: BaseAudioContext;
  private readonly random: () => number;

  constructor(ctx: BaseAudioContext, random: () => number = Math.random) {
    this.ctx = ctx;
    this.random = random;
  }

  setKit(kit: LoadedKit | null) {
    this.kit = kit;
    this.rrLast.clear();
  }

  get count() {
    return this.voices.length;
  }

  private curve(v: number) {
    return Math.pow(v / 127, 1.6 * this.velCurve);
  }

  /** Level for a velocity played by a layer rendered at `layerVel`. */
  gainFor(vel: number, layerVel: number, singleLayer: boolean) {
    // Rendered layers already carry the loudness of their velocity; only correct the gap to the nearest layer.
    if (singleLayer) return Math.min(this.curve(vel), 1);
    return Math.min(this.curve(vel) / this.curve(layerVel), 1.8);
  }

  /** The sample a hit plays: nearest layer, then a round-robin that differs from the last one. */
  pick(art: string, vel: number) {
    const layers = this.kit?.layers.get(art);
    if (!layers?.length) return null;
    let best = layers[0];
    for (const l of layers) if (Math.abs(l.velocity - vel) < Math.abs(best.velocity - vel)) best = l;
    const n = best.buffers.length;
    if (!n) return null;
    const key = `${art}:${best.velocity}`;
    let idx = Math.floor(this.random() * n);
    if (n > 1 && idx === this.rrLast.get(key)) idx = (idx + 1 + Math.floor(this.random() * (n - 1))) % n;
    this.rrLast.set(key, idx);
    return { buffer: best.buffers[idx], gain: this.gainFor(vel, best.velocity, layers.length === 1) };
  }

  /** Plays one hit at `when` into `out`. */
  trigger(art: string, vel: number, when: number, out: AudioNode) {
    const s = this.pick(art, vel);
    if (s) this.play(art, s.buffer, s.gain, when, out);
  }

  /** Plays a given buffer as an articulation, honouring its choke group and the voice cap. */
  play(art: string, buffer: AudioBuffer, gain: number, when: number, out: AudioNode) {
    this.voices = this.voices.filter((v) => v.end > when);
    const def = ART_BY_ID[art];
    if (def?.chokeGroup && def.chokes) {
      for (const v of this.voices) if (v.chokeGroup === def.chokeGroup && v.start < when) this.release(v, when, 0.012);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(when);
    const voice: Voice = { src, gain: g, start: when, end: when + buffer.duration, chokeGroup: def?.chokeGroup };
    this.voices.push(voice);
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      src.disconnect();
      g.disconnect();
    };
    if (this.voices.length > MAX_VOICES) this.release(this.voices[0], when, 0.02);
  }

  private release(v: Voice, when: number, time: number) {
    if (v.end <= when) return;
    try {
      v.gain.gain.cancelScheduledValues(when);
      v.gain.gain.setTargetAtTime(0, when, time / 3);
      const stopAt = when + time * 2;
      if (stopAt < v.end) {
        v.src.stop(stopAt);
        v.end = stopAt;
      }
    } catch {
      /* already stopped */
    }
  }

  /** Stops everything: queued voices are cancelled, sounding ones fade over `time` seconds. */
  stopAll(time: number) {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.start > now) {
        try {
          v.src.stop();
        } catch {
          /* not started */
        }
        v.src.onended = null;
        v.src.disconnect();
        v.gain.disconnect();
      } else this.release(v, now, time);
    }
    this.voices = this.voices.filter((v) => v.start <= now);
  }
}
