// Offline audio for export: alphaTab's audio exporter synthesises the song faster than real time
// (no speakers involved), or a loaded recording is decoded and lined up. Output: 16-bit stereo WAV.
import * as alphaTab from '@coderline/alphatab';
import type { Song } from '../../../model/types';
import type { ScorePlayer } from '../player';

export const SAMPLE_RATE = 44100;

export interface RenderedAudio {
  /** Interleaved stereo samples. */
  samples: Float32Array;
  sampleRate: number;
  /** Song length as alphaTab's synthesizer timed it (ms). */
  synthEndMs: number;
  renderMs: number;
}

/**
 * Synthesise the song. `exclude` = track ids left out (e.g. the parts being exported);
 * muted tracks are always left out, and with any track soloed only soloed tracks play.
 */
export async function renderMix(player: ScorePlayer, song: Song, exclude: string[] = []): Promise<RenderedAudio> {
  const t0 = performance.now();
  const opts = new alphaTab.synth.AudioExportOptions();
  opts.sampleRate = SAMPLE_RATE;
  opts.masterVolume = 1;
  opts.metronomeVolume = 0;
  opts.useSyncPoints = false;
  const anySolo = song.tracks.some((t) => t.mixer.solo);
  song.tracks.forEach((t, i) => {
    const on = !t.mixer.mute && (!anySolo || t.mixer.solo) && !exclude.includes(t.id);
    opts.trackVolume.set(i, on ? 1 : 0);
  });
  const exporter = await player.api.exportAudio(opts);
  const chunks: Float32Array[] = [];
  let total = 0;
  let endMs = 0;
  try {
    for (;;) {
      const c = await exporter.render(1000);
      if (!c) break;
      chunks.push(c.samples);
      total += c.samples.length;
      endMs = c.endTime;
    }
  } finally {
    (exporter as unknown as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.();
  }
  const samples = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    samples.set(c, o);
    o += c.length;
  }
  return { samples, sampleRate: SAMPLE_RATE, synthEndMs: endMs, renderMs: Math.round(performance.now() - t0) };
}

/** Decode a recording (WAV/MP3/OGG/FLAC) to interleaved stereo at SAMPLE_RATE. */
export async function decodeRecording(path: string): Promise<Float32Array> {
  const f = await window.mg.readFile(path);
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE); // decoding only; never plays
  const buf = await ctx.decodeAudioData(f.bytes.slice().buffer as ArrayBuffer);
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const out = new Float32Array(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    out[2 * i] = l[i];
    out[2 * i + 1] = r[i];
  }
  return out;
}

/**
 * Place `src` (interleaved stereo) so that source time `srcStartMs` lands at output time `atMs`,
 * in an output `lengthMs` long. Anything outside is cut; gaps are silence.
 */
export function place(src: Float32Array, srcStartMs: number, atMs: number, lengthMs: number, sr = SAMPLE_RATE): Float32Array {
  const frames = Math.round((lengthMs / 1000) * sr);
  const out = new Float32Array(frames * 2);
  const shift = Math.round(((atMs - srcStartMs) / 1000) * sr); // output frame = source frame + shift
  const srcFrames = src.length / 2;
  const from = Math.max(0, shift);
  const to = Math.min(frames, srcFrames + shift);
  if (to > from) out.set(src.subarray((from - shift) * 2, (to - shift) * 2), from * 2);
  return out;
}

/** 16-bit PCM WAV bytes from interleaved stereo floats. */
export function wavBytes(samples: Float32Array, sr = SAMPLE_RATE): Uint8Array {
  const frames = samples.length / 2;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * 4, true);
  // Keep the peak under full scale.
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const k = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * k * 32767))), true);
  }
  return new Uint8Array(buf);
}

/** Length in ms of a WAV file's audio (from its header). */
export function wavLengthMs(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sr = v.getUint32(24, true);
  const blockAlign = v.getUint16(32, true);
  const dataBytes = v.getUint32(40, true);
  return (dataBytes / blockAlign / sr) * 1000;
}
