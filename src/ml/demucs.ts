// HT-Demucs host code: the STFT / ISTFT / chunking that the ONNX graph leaves out.
// Ported from demucs-onnx (https://github.com/HRSadeghi/demucs-onnx, js/src, MIT licence,
// (c) 2026 Hamidreza Sadeghi), which reproduces HTDemucs._spec / _ispec and demucs.apply.
// Pure: the model call is passed in, so this runs in plain Node tests too.
import { RealFft, hannPeriodic } from './dsp';

export interface DemucsConfig {
  name: string;
  sources: string[];
  samplerate: number;
  audio_channels: number;
  segment_samples: number;
  nfft: number;
  hop: number;
  freq_bins: number;
  frames: number;
}

/** Runs the graph on one batch: mix [B,2,L], mag [B,4,F,T] -> spec [B,S,4,F,T], wav [B,S,2,L]. */
export type DemucsRun = (mix: Float32Array, mag: Float32Array, batch: number) => Promise<{ spec: Float32Array; wav: Float32Array }>;

class Spectrogram {
  readonly freqBins: number;
  readonly frames: number;
  private pad: number;
  private rightPad: number;
  private padded: number;
  private centred: number;
  private trim: number;
  private fwdScale: number;
  private invScale: number;
  private win: Float64Array;
  private envelope: Float64Array;
  private fft: RealFft;
  private re: Float64Array;
  private im: Float64Array;
  private buf: Float64Array;
  private acc: Float64Array;

  constructor(private nfft: number, private hop: number, private channels: number, private length: number) {
    this.freqBins = nfft / 2;
    this.frames = Math.ceil(length / hop);
    this.pad = Math.floor(hop / 2) * 3;
    this.rightPad = this.pad + this.frames * hop - length;
    this.padded = length + this.pad + this.rightPad;
    this.centred = this.padded + nfft;
    this.trim = nfft / 2 + this.pad;
    this.fwdScale = 1 / Math.sqrt(nfft);
    this.invScale = Math.sqrt(nfft);
    this.fft = new RealFft(nfft);
    const totalFrames = 1 + this.padded / hop;
    const totalSamples = nfft + hop * (totalFrames - 1);
    this.win = hannPeriodic(nfft);
    this.envelope = new Float64Array(totalSamples);
    for (let t = 0; t < totalFrames; t++) for (let j = 0; j < nfft; j++) this.envelope[t * hop + j] += this.win[j] * this.win[j];
    this.re = new Float64Array(this.freqBins + 1);
    this.im = new Float64Array(this.freqBins + 1);
    this.buf = new Float64Array(nfft);
    this.acc = new Float64Array(totalSamples);
  }

  get itemSize() {
    return 2 * this.channels * this.freqBins * this.frames;
  }

  forward(mix: Float32Array, batch: number, out: Float32Array) {
    const { nfft, hop, channels, length } = this;
    const planeSize = this.freqBins * this.frames;
    const inner = new Float32Array(this.padded);
    const cen = new Float32Array(this.centred);
    for (let plane = 0; plane < batch * channels; plane++) {
      reflectInto(mix, plane * length, length, this.pad, this.rightPad, inner, 0);
      reflectInto(inner, 0, this.padded, nfft / 2, nfft / 2, cen, 0);
      const item = Math.floor(plane / channels);
      const ch = plane % channels;
      const reBase = (item * 2 * channels + 2 * ch) * planeSize;
      const imBase = reBase + planeSize;
      for (let fr = 0; fr < this.frames; fr++) {
        const at = (fr + 2) * hop;
        for (let j = 0; j < nfft; j++) this.buf[j] = cen[at + j] * this.win[j];
        this.fft.forward(this.buf, this.re, this.im);
        for (let f = 0; f < this.freqBins; f++) {
          out[reBase + f * this.frames + fr] = this.re[f] * this.fwdScale;
          out[imBase + f * this.frames + fr] = this.im[f] * this.fwdScale;
        }
      }
    }
  }

  inverse(spec: Float32Array, items: number, out: Float32Array) {
    const { nfft, hop, channels, length } = this;
    const planeSize = this.freqBins * this.frames;
    this.re[this.freqBins] = 0;
    this.im[this.freqBins] = 0;
    for (let plane = 0; plane < items * channels; plane++) {
      this.acc.fill(0);
      const item = Math.floor(plane / channels);
      const ch = plane % channels;
      const reBase = (item * 2 * channels + 2 * ch) * planeSize;
      const imBase = reBase + planeSize;
      for (let fr = 0; fr < this.frames; fr++) {
        for (let f = 0; f < this.freqBins; f++) {
          this.re[f] = spec[reBase + f * this.frames + fr];
          this.im[f] = spec[imBase + f * this.frames + fr];
        }
        this.fft.inverse(this.re, this.im, this.buf);
        const at = (fr + 2) * hop;
        for (let j = 0; j < nfft; j++) this.acc[at + j] += this.buf[j] * this.invScale * this.win[j];
      }
      const ob = plane * length;
      for (let i = 0; i < length; i++) out[ob + i] = this.acc[this.trim + i] / this.envelope[this.trim + i];
    }
  }
}

function reflectInto(input: Float32Array, from: number, n: number, left: number, right: number, out: Float32Array, at: number) {
  for (let i = 0; i < left; i++) out[at + i] = input[from + left - i];
  out.set(input.subarray(from, from + n), at + left);
  for (let i = 0; i < right; i++) out[at + left + n + i] = input[from + n - 2 - i];
}

/** demucs' triangular cross-fade weight. */
function transitionWeight(segment: number): Float32Array {
  const w = new Float32Array(segment);
  let peak = 0;
  for (let i = 0; i < segment; i++) {
    w[i] = i < Math.floor(segment / 2) ? i + 1 : segment - i;
    peak = Math.max(peak, w[i]);
  }
  for (let i = 0; i < segment; i++) w[i] /= peak;
  return w;
}

/**
 * Separate a stereo mix (planar: L then R, `samples` each, at config.samplerate) into stems.
 * Returns one planar stereo Float32Array per source. Overlap 0.25 like demucs.
 * `progress(done, total)` after each batch; `cancelled()` is polled between batches.
 */
export async function separate(
  cfg: DemucsConfig, run: DemucsRun, mix: Float32Array, samples: number, batch: number,
  progress?: (done: number, total: number) => void, cancelled?: () => boolean,
): Promise<Float32Array[]> {
  const C = cfg.audio_channels;
  const L = cfg.segment_samples;
  const S = cfg.sources.length;
  const spec = new Spectrogram(cfg.nfft, cfg.hop, C, L);
  if (spec.frames !== cfg.frames) throw new Error(`STFT gives ${spec.frames} frames, graph expects ${cfg.frames}`);
  // Global normalisation of the mono reference (demucs apply_model).
  let sum = 0, sq = 0;
  for (let i = 0; i < samples; i++) {
    let v = 0;
    for (let c = 0; c < C; c++) v += mix[c * samples + i];
    v /= C;
    sum += v; sq += v * v;
  }
  const mean = sum / samples;
  const gain = Math.sqrt(Math.max(0, sq / samples - mean * mean)) + 1e-8;

  const stride = Math.max(1, Math.floor(0.75 * L));
  const chunks = Math.ceil(samples / stride);
  const weight = transitionWeight(L);
  const out = Array.from({ length: S }, () => new Float32Array(C * samples));
  const wsum = new Float32Array(samples);
  const mixBuf = new Float32Array(batch * C * L);
  const magBuf = new Float32Array(batch * spec.itemSize);
  const stems = new Float32Array(batch * S * C * L);

  for (let g = 0; g * batch < chunks; g++) {
    if (cancelled?.()) throw new Error('Cancelled');
    mixBuf.fill(0);
    const info: { offset: number; length: number; trim: number }[] = [];
    for (let slot = 0; slot < batch; slot++) {
      const offset = (g * batch + slot) * stride;
      if (offset >= samples) break;
      const length = Math.min(samples - offset, L);
      const trim = Math.floor((L - length) / 2);
      const start = offset - trim;
      const from = Math.max(0, start);
      const to = Math.min(samples, start + L);
      const at = from - start;
      for (let c = 0; c < C; c++) {
        const d = (slot * C + c) * L + at;
        const s = c * samples + from;
        for (let i = 0; i < to - from; i++) mixBuf[d + i] = (mix[s + i] - mean) / gain;
      }
      info.push({ offset, length, trim });
    }
    const count = info.length;
    spec.forward(mixBuf, count, magBuf);
    const r = await run(mixBuf.subarray(0, count * C * L), magBuf.subarray(0, count * spec.itemSize), count);
    spec.inverse(r.spec, count * S, stems);
    const used = count * S * C * L;
    for (let i = 0; i < used; i++) stems[i] += r.wav[i];
    for (let slot = 0; slot < count; slot++) {
      const { offset, length, trim } = info[slot];
      for (let s = 0; s < S; s++) {
        for (let c = 0; c < C; c++) {
          const src = ((slot * S + s) * C + c) * L + trim;
          const dst = c * samples + offset;
          const o = out[s];
          for (let i = 0; i < length; i++) o[dst + i] += stems[src + i] * weight[i];
        }
      }
      for (let i = 0; i < length; i++) wsum[offset + i] += weight[i];
    }
    progress?.(Math.min(chunks, (g + 1) * batch), chunks);
  }
  for (const o of out) {
    for (let c = 0; c < C; c++) {
      for (let i = 0; i < samples; i++) {
        const k = c * samples + i;
        o[k] = (o[k] / wsum[i]) * gain + mean;
      }
    }
  }
  return out;
}
