import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

const text = (v: DataView, at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(at + i)));
const s24 = (v: DataView, at: number) => {
  const x = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
  return x & 0x800000 ? x - 0x1000000 : x;
};

describe('WAV encoder', () => {
  it('writes a 24-bit PCM header', () => {
    const v = new DataView(encodeWav([new Float32Array(4), new Float32Array(4)], 44100));
    expect([text(v, 0), text(v, 8), text(v, 12), text(v, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(4, true)).toBe(36 + 24);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 6);
    expect(v.getUint16(32, true)).toBe(6);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(24);
  });

  it('interleaves and scales samples, clipping past full scale', () => {
    const v = new DataView(encodeWav([new Float32Array([0, 1, 0.5, 2]), new Float32Array([0, -1, -0.5, -2])], 48000));
    const samples = Array.from({ length: 8 }, (_, i) => s24(v, 44 + i * 3));
    expect(samples).toEqual([0, 0, 8388607, -8388608, 4194304, -4194304, 8388607, -8388608]);
  });

  it('pads an odd-sized data chunk', () => {
    const buf = encodeWav([new Float32Array(3)], 48000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 9 + 1);
    expect(v.getUint32(40, true)).toBe(9);
    expect(v.getUint32(4, true)).toBe(36 + 10);
  });
});
