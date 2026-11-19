/** 24-bit PCM WAV encoder. */

export const WAV_BITS = 24;

const MAX_POS = 0x7fffff;
const MAX_NEG = 0x800000;

function writeAscii(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/** Interleaves the channels into a 24-bit WAV file. Samples outside ±1 are clipped. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = Math.max(1, channels.length);
  const frames = channels.length ? Math.min(...channels.map((c) => c.length)) : 0;
  const blockAlign = numCh * 3;
  const dataSize = frames * blockAlign;
  const pad = dataSize % 2; // RIFF chunks are word-aligned
  const buf = new ArrayBuffer(44 + dataSize + pad);
  const view = new DataView(buf);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize + pad, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(buf, 44, dataSize);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c][i];
      const s = x >= 1 ? MAX_POS : x <= -1 ? -MAX_NEG : x > 0 ? Math.round(x * MAX_POS) : Math.round(x * MAX_NEG) || 0;
      out[o++] = s & 0xff;
      out[o++] = (s >> 8) & 0xff;
      out[o++] = (s >> 16) & 0xff;
    }
  }
  return buf;
}
