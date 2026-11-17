// Minimal WAV reader/writer (PCM 16/24/32-bit, float 32) for the analysis worker. Pure.

export interface Pcm {
  sampleRate: number;
  /** One Float32Array per channel. */
  channels: Float32Array[];
}

export function readWav(buf: Uint8Array): Pcm {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let fmt = 1, nch = 2, sr = 44100, bits = 16;
  let data = -1, dataLen = 0;
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const len = dv.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = dv.getUint16(o + 8, true);
      nch = dv.getUint16(o + 10, true);
      sr = dv.getUint32(o + 12, true);
      bits = dv.getUint16(o + 22, true);
      if (fmt === 0xfffe) fmt = dv.getUint16(o + 32, true);
    } else if (id === 'data') {
      data = o + 8;
      dataLen = Math.min(len, buf.length - data);
      break;
    }
    o += 8 + len + (len & 1);
  }
  if (data < 0) throw new Error('WAV has no data');
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const p = data + (i * nch + c) * bps;
      let v: number;
      if (fmt === 3 && bits === 32) v = dv.getFloat32(p, true);
      else if (bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (bits === 24) v = ((buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)) << 8 >> 8) / 8388608;
      else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else if (bits === 8) v = (buf[p] - 128) / 128;
      else throw new Error(`Unsupported WAV format (${bits}-bit)`);
      channels[c][i] = v;
    }
  }
  return { sampleRate: sr, channels };
}

/** 16-bit PCM WAV (stems are listened to and re-analysed; 16 bit is plenty and half the size). */
export function writeWav16(p: Pcm): Uint8Array {
  const nch = p.channels.length;
  const n = p.channels[0]?.length ?? 0;
  const out = new Uint8Array(44 + n * nch * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * nch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
  dv.setUint32(24, p.sampleRate, true); dv.setUint32(28, p.sampleRate * nch * 2, true);
  dv.setUint16(32, nch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, p.channels[c][i]));
      dv.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}
