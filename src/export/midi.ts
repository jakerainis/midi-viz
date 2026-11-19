/**
 * Standard MIDI File writer. @tonejs/midi can write tempo, time signatures and markers, but it always ends a track
 * right after its last note-off, so a section ending in silence would come out short (DAWs and our own importer
 * size the region from the End of Track). Writing the bytes here keeps the file exactly as long as the range.
 *
 * Layout: Type 1, PPQ 960. Track 0 holds the name, time signatures, tempos and markers; track 1 holds the drums
 * on channel 10.
 */
import { TempoMap } from '../model/timing';
import { PPQ } from '../model/types';
import type { MeterPoint, TempoPoint } from '../model/types';
import type { Marker, Plan } from './plan';

/** Drum notes are triggers; a 1/32 is long enough for any sampler and short enough not to overlap. */
export const NOTE_TICKS = PPQ / 8;
/** MIDI channel 10, zero-based. */
export const DRUM_CHANNEL = 9;

export interface MidiNote {
  tick: number;
  note: number;
  vel: number;
  dur: number;
}

export interface SmfData {
  ppq: number;
  name: string;
  trackName: string;
  /** Zero-based. */
  channel: number;
  /** End of Track lands here (or after the last event if that's later). */
  lengthTicks: number;
  tempo: TempoPoint[];
  meter: MeterPoint[];
  markers: Marker[];
  notes: MidiNote[];
}

export interface MidiExportOptions {
  /** Written into track 0 as the sequence name. */
  name: string;
  /** Every tempo and time-signature change in the range; otherwise only the ones at the start. */
  tempoChanges: boolean;
  /** Section names as marker events. */
  markers: boolean;
  /** Velocity curve exponent baked into the velocities (1 leaves them alone). */
  velCurve: number;
}

const clamp7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** Velocity through the app's curve, so a plugin with a plain response hears what the app plays. */
export const curveVelocity = (vel: number, curve: number) =>
  curve === 1 ? vel : Math.max(1, clamp7(127 * Math.pow(vel / 127, curve)));

/**
 * The notes of a plan: humanize offsets turned into ticks through the tempo map, kept inside the range, one note
 * per pitch and tick (the loudest wins), each as long as a 1/32 but never past the next hit on the same note.
 */
export function notesFromPlan(plan: Plan, velCurve = 1): MidiNote[] {
  const end = plan.lengthTicks;
  if (end <= 0) return [];
  const tempo = new TempoMap(plan.tempo);
  const loudest = new Map<string, { tick: number; note: number; vel: number }>();
  for (const ev of plan.events) {
    let tick = ev.tick;
    if (ev.offsetSec) tick = Math.round(tempo.tick(tempo.seconds(ev.tick) + ev.offsetSec));
    tick = Math.max(0, Math.min(end - 1, Math.round(tick)));
    const vel = curveVelocity(ev.vel, velCurve);
    const key = `${tick}|${ev.note}`;
    const prev = loudest.get(key);
    if (!prev || vel > prev.vel) loudest.set(key, { tick, note: ev.note, vel });
  }
  const sorted = [...loudest.values()].sort((a, b) => a.tick - b.tick || a.note - b.note);
  const out: MidiNote[] = new Array(sorted.length);
  const nextOn = new Map<number, number>();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = sorted[i];
    const dur = Math.min(NOTE_TICKS, (nextOn.get(n.note) ?? Infinity) - n.tick, end - n.tick);
    out[i] = { ...n, dur: Math.max(1, dur) };
    nextOn.set(n.note, n.tick);
  }
  return out;
}

export function midiFromPlan(plan: Plan, opts: MidiExportOptions) {
  return writeSmf({
    ppq: PPQ,
    name: opts.name,
    trackName: 'Drums',
    channel: DRUM_CHANNEL,
    lengthTicks: plan.lengthTicks,
    tempo: opts.tempoChanges ? plan.tempo : plan.tempo.slice(0, 1),
    meter: opts.tempoChanges ? plan.meter : plan.meter.slice(0, 1),
    markers: opts.markers ? plan.markers : [],
    notes: notesFromPlan(plan, opts.velCurve),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bytes

interface TrackEvent {
  tick: number;
  /** Order among events on the same tick: names, meters, tempos, markers; note-offs before note-ons. */
  order: number;
  data: number[];
}

const utf8 = (s: string) => Array.from(new TextEncoder().encode(s));

function vlq(value: number) {
  let n = Math.max(0, Math.round(value));
  const bytes = [n & 0x7f];
  while ((n = Math.floor(n / 128)) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const meta = (type: number, bytes: number[]) => [0xff, type, ...vlq(bytes.length), ...bytes];

function chunk(id: string, body: number[]) {
  return [...utf8(id), ...u32(body.length), ...body];
}

function trackChunk(events: TrackEvent[], length: number) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    for (const b of vlq(e.tick - last)) body.push(b);
    for (const b of e.data) body.push(b);
    last = e.tick;
  }
  for (const b of [...vlq(Math.max(0, length - last)), 0xff, 0x2f, 0x00]) body.push(b);
  return chunk('MTrk', body);
}

export function writeSmf(d: SmfData): Uint8Array<ArrayBuffer> {
  const ch = d.channel & 0x0f;
  const conductor: TrackEvent[] = [{ tick: 0, order: 0, data: meta(0x03, utf8(d.name)) }];
  for (const m of d.meter) {
    const den = Math.max(0, Math.round(Math.log2(Math.max(1, m.den))));
    conductor.push({ tick: m.tick, order: 1, data: meta(0x58, [Math.max(1, Math.min(255, m.num)), den, 24, 8]) });
  }
  for (const t of d.tempo) {
    const us = Math.max(1, Math.min(0xffffff, Math.round(60_000_000 / t.bpm)));
    conductor.push({ tick: t.tick, order: 2, data: meta(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) });
  }
  for (const m of d.markers) conductor.push({ tick: m.tick, order: 3, data: meta(0x06, utf8(m.text)) });

  const drums: TrackEvent[] = [{ tick: 0, order: 0, data: meta(0x03, utf8(d.trackName)) }];
  let lastTick = 0;
  for (const n of d.notes) {
    const off = n.tick + Math.max(1, n.dur);
    drums.push({ tick: n.tick, order: 2, data: [0x90 | ch, n.note & 0x7f, Math.max(1, clamp7(n.vel))] });
    drums.push({ tick: off, order: 1, data: [0x80 | ch, n.note & 0x7f, 64] });
    lastTick = Math.max(lastTick, off);
  }
  for (const e of conductor) lastTick = Math.max(lastTick, e.tick);
  const length = Math.max(d.lengthTicks, lastTick);

  const bytes = [
    ...chunk('MThd', [...u16(1), ...u16(2), ...u16(d.ppq)]),
    ...trackChunk(conductor, length),
    ...trackChunk(drums, length),
  ];
  return new Uint8Array(bytes);
}
