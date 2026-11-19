/**
 * The audio engine: plain Web Audio, no React. It owns the AudioContext, the loaded kit and a look-ahead
 * scheduler that walks the song in ticks through the tempo map, so tempo changes, loops and seeks stay exact.
 *
 * Every sample voice is created per hit and thrown away when it ends. Nothing is rebuilt when the song changes,
 * only the compiled event list.
 */
import { compileSong, songEnd } from '../model/compile';
import type { SongEvent } from '../model/compile';
import { MeterMap, TempoMap, beatTicksFor } from '../model/timing';
import { PPQ } from '../model/types';
import type { Pattern, Song } from '../model/types';
import type { LoadedKit } from './kit';
import { VoicePlayer, dbToGain, masterChain, setMasterLevel } from './voices';

const LOOKAHEAD = 0.15;
const INTERVAL_MS = 25;

/** A stretch of playback where song time runs linearly from `tick` at context time `ctxTime`. */
interface Segment {
  ctxTime: number;
  tick: number;
  sec: number;
}

type Mode = 'song' | 'preview';

export interface EngineSnapshot {
  playing: boolean;
  mode: Mode;
  previewKey?: string;
}

export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private player: VoicePlayer;
  private trackGains = new Map<string, GainNode>();
  private auditionGain: GainNode;

  private song: Song | null = null;
  private events: SongEvent[] = [];
  tempo = new TempoMap([{ tick: 0, bpm: 120 }]);
  meter = new MeterMap([{ tick: 0, num: 4, den: 4 }]);
  private endTick = 0;
  private loop = { start: 0, end: 0, on: false };

  private timer: number | null = null;
  private segments: Segment[] = [];
  /** Song tick up to which events have been scheduled. */
  private schedTick = 0;
  private nextClickTick = 0;

  private mode: Mode = 'song';
  private previewKey?: string;
  private preview: { events: SongEvent[]; length: number; tempo: TempoMap } | null = null;

  /** Where playback starts (and where the playhead rests when stopped). */
  cursor = 0;
  playing = false;
  metronome = false;
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot = { playing: false, mode: 'song' };

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = masterChain(this.ctx);
    this.player = new VoicePlayer(this.ctx);
    this.auditionGain = this.ctx.createGain();
    this.auditionGain.connect(this.master);
  }

  // ---- subscriptions (useSyncExternalStore) ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = { playing: this.playing, mode: this.mode, previewKey: this.previewKey };
    this.listeners.forEach((fn) => fn());
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get kit() {
    return this.player.kit;
  }

  setKit(kit: LoadedKit) {
    this.player.setKit(kit);
  }

  /** Velocity curve exponent: 1 = linear, <1 = louder soft hits, >1 = more dynamic. */
  get velCurve() {
    return this.player.velCurve;
  }

  set velCurve(c: number) {
    this.player.velCurve = c;
  }

  /** Voices sounding or queued (for diagnostics). */
  get voiceCount() {
    return this.player.count;
  }

  setMasterDb(db: number) {
    setMasterLevel(this.master, db, this.ctx);
  }

  // ---- song ----

  setSong(song: Song) {
    const tempoChanged = !this.song || this.song.tempo !== song.tempo;
    this.song = song;
    this.events = compileSong(song);
    this.meter = new MeterMap(song.meter);
    this.loop = { ...song.loop };
    this.endTick = songEnd(song);
    for (const t of song.tracks) {
      let g = this.trackGains.get(t.id);
      if (!g) {
        g = this.ctx.createGain();
        g.connect(this.master);
        this.trackGains.set(t.id, g);
      }
      g.gain.setTargetAtTime(dbToGain(t.volumeDb), this.ctx.currentTime, 0.02);
    }
    if (tempoChanged) {
      // Re-anchor so the playhead keeps its tick when the tempo map changes under it.
      const now = this.mode === 'song' && this.playing ? this.position() : null;
      this.tempo = new TempoMap(song.tempo);
      if (now !== null) this.restartAt(now);
    }
    // Other edits need nothing: the scheduler reads the new events as it reaches them. Hits already queued in
    // the look-ahead window (≤150 ms) keep the old version.
  }

  // ---- transport ----

  /** Live song position in ticks (compensated for output latency). */
  position(): number {
    if (!this.playing || this.mode !== 'song') return this.cursor;
    const t = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    let seg = this.segments[0];
    for (const s of this.segments) if (s.ctxTime <= t) seg = s;
    if (!seg) return this.cursor;
    return Math.max(0, this.tempo.tick(seg.sec + Math.max(0, t - seg.ctxTime)));
  }

  /** Preview playhead as a 0–1 fraction of the previewed pattern. */
  previewProgress(): number {
    if (!this.playing || this.mode !== 'preview' || !this.preview) return 0;
    const t = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    let seg = this.segments[0];
    for (const s of this.segments) if (s.ctxTime <= t) seg = s;
    if (!seg) return 0;
    const tick = this.preview.tempo.tick(seg.sec + Math.max(0, t - seg.ctxTime));
    return (tick % this.preview.length) / this.preview.length;
  }

  async play(from?: number) {
    await this.resume();
    if (this.playing) this.halt(false);
    this.mode = 'song';
    this.previewKey = undefined;
    this.preview = null;
    if (from !== undefined) this.cursor = Math.max(0, from);
    if (this.loop.on && (this.cursor >= this.loop.end || this.cursor < this.loop.start) && from === undefined) {
      // Starting outside an active loop starts at the loop.
      if (this.cursor >= this.loop.end) this.cursor = this.loop.start;
    }
    this.startScheduler(this.cursor);
  }

  /** Stops where the playhead is (Home goes back to the start). */
  stop() {
    if (!this.playing) return;
    if (this.mode === 'song') this.cursor = this.position();
    this.halt(true);
  }

  toggle() {
    if (this.playing) this.stop();
    else void this.play();
  }

  /** Moves the cursor; when playing, playback jumps there. */
  seek(tick: number) {
    const t = Math.max(0, tick);
    this.cursor = t;
    if (this.playing && this.mode === 'song') this.restartAt(t);
    else this.emit();
  }

  setLoop(loop: { start: number; end: number; on: boolean }) {
    this.loop = { ...loop };
  }

  private restartAt(tick: number) {
    this.player.stopAll(0.02);
    this.startScheduler(tick);
  }

  private startScheduler(tick: number) {
    if (this.timer !== null) window.clearInterval(this.timer);
    const ctxTime = this.ctx.currentTime + 0.05;
    const tempo = this.mode === 'preview' && this.preview ? this.preview.tempo : this.tempo;
    this.segments = [{ ctxTime, tick, sec: tempo.seconds(tick) }];
    this.schedTick = tick;
    this.nextClickTick = this.nextBeatAtOrAfter(tick);
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), INTERVAL_MS);
    this.schedule();
    this.emit();
  }

  private halt(fade: boolean) {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    if (fade) this.player.stopAll(0.04);
    this.segments = [];
    this.mode = 'song';
    this.previewKey = undefined;
    this.preview = null;
    this.emit();
  }

  // ---- library preview ----

  /** Loops one pattern at a tempo, independent of the song. */
  async previewPattern(key: string, pattern: Pattern, bpm: number) {
    await this.resume();
    if (this.playing) this.halt(true);
    const events: SongEvent[] = pattern.hits
      .filter((h) => h.tick < pattern.lengthTicks)
      .map((h) => ({ tick: h.tick, art: h.art, vel: h.vel, trackId: '', clipId: '', jitterMs: 0, jitterVel: 0 }))
      .sort((a, b) => a.tick - b.tick);
    this.preview = { events, length: pattern.lengthTicks, tempo: new TempoMap([{ tick: 0, bpm }]) };
    this.mode = 'preview';
    this.previewKey = key;
    this.startScheduler(0);
  }

  stopPreview() {
    if (this.mode === 'preview') this.halt(true);
  }

  // ---- scheduling ----

  private nextBeatAtOrAfter(tick: number) {
    const m = this.meter.meterAt(tick);
    const beat = beatTicksFor(m.den);
    return m.tick + Math.ceil((tick - m.tick) / beat - 1e-9) * beat;
  }

  private schedule() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    const preview = this.mode === 'preview' ? this.preview : null;
    const tempo = preview ? preview.tempo : this.tempo;
    // Several loop wraps can fall inside one window at very short loops; cap the work per call.
    for (let guard = 0; guard < 16; guard++) {
      const seg = this.segments[this.segments.length - 1];
      const horizonTick = tempo.tick(seg.sec + (horizon - seg.ctxTime));
      let wrapAt = Infinity;
      let wrapTo = 0;
      if (preview) {
        wrapAt = Math.ceil((this.schedTick + 1) / preview.length) * preview.length;
        wrapTo = wrapAt;
      } else if (this.loop.on && this.loop.end > this.loop.start && this.schedTick < this.loop.end) {
        wrapAt = this.loop.end;
        wrapTo = this.loop.start;
      }
      const to = Math.min(horizonTick, wrapAt);
      this.scheduleRange(this.schedTick, to, seg, tempo, preview);
      this.schedTick = to;
      if (to < wrapAt) break;
      if (preview) {
        // Pattern loops are seamless in tick space, so no new segment is needed; keep walking.
        continue;
      }
      // Loop wrap: song time jumps back.
      const ctxAtWrap = seg.ctxTime + (tempo.seconds(wrapAt) - seg.sec);
      this.segments.push({ ctxTime: ctxAtWrap, tick: wrapTo, sec: tempo.seconds(wrapTo) });
      this.schedTick = wrapTo;
      this.nextClickTick = this.nextBeatAtOrAfter(wrapTo);
    }
    // Drop segments that are fully in the past.
    const now = this.ctx.currentTime - 0.5;
    while (this.segments.length > 1 && this.segments[1].ctxTime < now) this.segments.shift();
    // Stop after the end of the song (no loop).
    if (!preview && !this.loop.on && this.endTick > 0 && this.position() > this.endTick + PPQ) {
      this.cursor = 0;
      this.halt(false);
    }
  }

  private scheduleRange(from: number, to: number, seg: Segment, tempo: TempoMap, preview: AudioEngine['preview']) {
    if (to <= from) return;
    const at = (tick: number) => seg.ctxTime + (tempo.seconds(tick) - seg.sec);
    if (preview) {
      const len = preview.length;
      const cycle = Math.floor(from / len);
      for (let c = cycle; c * len < to; c++) {
        const base = c * len;
        for (const ev of preview.events) {
          const tick = base + ev.tick;
          if (tick < from || tick >= to) continue;
          this.player.trigger(ev.art, ev.vel, at(tick), this.auditionGain);
        }
      }
      return;
    }
    let i = lowerBound(this.events, from);
    for (; i < this.events.length && this.events[i].tick < to; i++) {
      const ev = this.events[i];
      const jitter = ev.jitterMs ? ((Math.random() * 2 - 1) * ev.jitterMs) / 1000 : 0;
      const vel = ev.jitterVel ? Math.round(ev.vel + (Math.random() * 2 - 1) * ev.jitterVel) : ev.vel;
      this.player.trigger(ev.art, clampVel(vel), Math.max(this.ctx.currentTime, at(ev.tick) + jitter), this.trackGains.get(ev.trackId) ?? this.master);
    }
    if (this.metronome) {
      while (this.nextClickTick < to) {
        if (this.nextClickTick >= from) {
          const m = this.meter.meterAt(this.nextClickTick);
          const barLen = (m.num * PPQ * 4) / m.den;
          const down = Math.abs(((this.nextClickTick - m.tick) % barLen)) < 1;
          this.click(at(this.nextClickTick), down);
        }
        this.nextClickTick = this.nextBeatAtOrAfter(this.nextClickTick + 1);
      }
    }
  }

  private click(when: number, down: boolean) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = down ? 1760 : 1320;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(down ? 0.35 : 0.22, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  // ---- voices ----

  /** Plays one hit right now (clicking a lane, drawing notes). */
  async audition(art: string, vel: number) {
    await this.resume();
    this.player.trigger(art, vel, this.ctx.currentTime + 0.005, this.auditionGain);
  }

  dispose() {
    this.halt(false);
    void this.ctx.close();
  }

  /**
   * Plays one exact sample of the loaded kit (the Kit view's layer × round-robin grid), bypassing layer and
   * round-robin choice. Without `vel` it plays at the level it was rendered at; with it, the velocity curve
   * corrects the gap to the layer as a normal hit would.
   */
  async auditionSample(art: string, layerIndex: number, rrIndex: number, vel?: number) {
    await this.resume();
    const layers = this.kit?.layers.get(art);
    const layer = layers?.[layerIndex];
    const buffer = layer?.buffers[rrIndex];
    if (!layer || !buffer) return;
    const gain = vel === undefined ? 1 : this.player.gainFor(vel, layer.velocity, layers!.length === 1);
    this.player.play(art, buffer, gain, this.ctx.currentTime + 0.005, this.auditionGain);
  }
}

const clampVel = (v: number) => Math.max(1, Math.min(127, v));

function lowerBound(events: SongEvent[], tick: number) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const engine = new AudioEngine();
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
