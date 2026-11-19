import { PPQ } from './types';
import type { MeterPoint, TempoPoint } from './types';

/** Converts between song ticks and seconds through every tempo change (steps, no ramps). */
export class TempoMap {
  readonly points: TempoPoint[];
  private readonly startSec: number[];

  constructor(points: TempoPoint[]) {
    const sorted = [...points].filter((p) => p.bpm > 0).sort((a, b) => a.tick - b.tick);
    if (!sorted.length || sorted[0].tick > 0) sorted.unshift({ tick: 0, bpm: sorted[0]?.bpm ?? 120 });
    this.points = sorted;
    this.startSec = [0];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      this.startSec.push(this.startSec[i - 1] + ((sorted[i].tick - prev.tick) * 60) / (prev.bpm * PPQ));
    }
  }

  private indexAtTick(tick: number) {
    let lo = 0;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.points[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  bpmAt(tick: number) {
    return this.points[this.indexAtTick(tick)].bpm;
  }

  seconds(tick: number) {
    const i = this.indexAtTick(tick);
    const p = this.points[i];
    return this.startSec[i] + ((tick - p.tick) * 60) / (p.bpm * PPQ);
  }

  tick(seconds: number) {
    let lo = 0;
    let hi = this.startSec.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.startSec[mid] <= seconds) lo = mid;
      else hi = mid - 1;
    }
    const p = this.points[lo];
    return p.tick + ((seconds - this.startSec[lo]) * p.bpm * PPQ) / 60;
  }
}

export const barTicksFor = (num: number, den: number) => (num * PPQ * 4) / den;
export const beatTicksFor = (den: number) => (PPQ * 4) / den;

/** Bars and beats through every time-signature change. Bars are 0-based inside, 1-based on screen. */
export class MeterMap {
  readonly points: MeterPoint[];
  private readonly startBar: number[];

  constructor(points: MeterPoint[]) {
    const sorted = [...points].sort((a, b) => a.tick - b.tick);
    if (!sorted.length || sorted[0].tick > 0) sorted.unshift({ tick: 0, num: 4, den: 4 });
    this.points = sorted;
    this.startBar = [0];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      this.startBar.push(this.startBar[i - 1] + Math.round((sorted[i].tick - prev.tick) / barTicksFor(prev.num, prev.den)));
    }
  }

  private indexAtTick(tick: number) {
    let i = 0;
    while (i + 1 < this.points.length && this.points[i + 1].tick <= tick) i++;
    return i;
  }

  private indexAtBar(bar: number) {
    let i = 0;
    while (i + 1 < this.startBar.length && this.startBar[i + 1] <= bar) i++;
    return i;
  }

  meterAt(tick: number) {
    return this.points[this.indexAtTick(tick)];
  }

  /** Fractional 0-based bar index at a tick. */
  barAt(tick: number) {
    const i = this.indexAtTick(tick);
    const p = this.points[i];
    return this.startBar[i] + (tick - p.tick) / barTicksFor(p.num, p.den);
  }

  /** Tick where a 0-based bar starts. Works past the last change and for fractional bars. */
  tickOfBar(bar: number) {
    const i = this.indexAtBar(Math.floor(bar));
    const p = this.points[i];
    return p.tick + (bar - this.startBar[i]) * barTicksFor(p.num, p.den);
  }

  barLength(tick: number) {
    const p = this.meterAt(tick);
    return barTicksFor(p.num, p.den);
  }

  /** Bar, beat and sixteenth (all 1-based) for the LCD, like "15.3.1". */
  bbt(tick: number) {
    const i = this.indexAtTick(Math.max(0, tick));
    const p = this.points[i];
    const barLen = barTicksFor(p.num, p.den);
    const beatLen = beatTicksFor(p.den);
    const rel = Math.max(0, tick) - p.tick;
    const bar = this.startBar[i] + Math.floor(rel / barLen);
    const inBar = rel - Math.floor(rel / barLen) * barLen;
    const beat = Math.floor(inBar / beatLen);
    const six = Math.floor((inBar - beat * beatLen) / (PPQ / 4));
    return { bar: bar + 1, beat: beat + 1, sixteenth: six + 1 };
  }

  /** Snaps a tick to the nearest (or floor) bar line. */
  snapBar(tick: number, mode: 'round' | 'floor' = 'round') {
    const b = this.barAt(tick);
    return this.tickOfBar(mode === 'round' ? Math.round(b) : Math.floor(b));
  }

  /** Snaps to the nearest beat. */
  snapBeat(tick: number, mode: 'round' | 'floor' = 'round') {
    const p = this.meterAt(tick);
    const beat = beatTicksFor(p.den);
    const rel = (tick - p.tick) / beat;
    return p.tick + (mode === 'round' ? Math.round(rel) : Math.floor(rel)) * beat;
  }
}

export const formatBBT = (b: { bar: number; beat: number; sixteenth: number }) => `${b.bar}.${b.beat}.${b.sixteenth}`;

export function formatClock(seconds: number) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}

/** Grid sizes for the editors, in ticks. */
export const GRIDS: { id: string; label: string; ticks: number }[] = [
  { id: '1/4', label: '1/4', ticks: PPQ },
  { id: '1/8', label: '1/8', ticks: PPQ / 2 },
  { id: '1/8T', label: '1/8T', ticks: PPQ / 3 },
  { id: '1/16', label: '1/16', ticks: PPQ / 4 },
  { id: '1/16T', label: '1/16T', ticks: PPQ / 6 },
  { id: '1/32', label: '1/32', ticks: PPQ / 8 },
  { id: '1/64', label: '1/64', ticks: PPQ / 16 },
];
