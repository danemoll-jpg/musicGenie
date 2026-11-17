// Signal helpers shared by the Round 6 audio analysis (pure, no Electron/DOM: unit-tested in Node).
// FFT, windows, resampling, downmix, log-mel features, peak picking.

/** In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of two. */
export class Fft {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let b = 0; b < bits; b++) v = (v << 1) | ((i >> b) & 1);
      this.rev[i] = v;
    }
  }

  /** Forward (inverse = false: e^-i) transform, unscaled. Inverse uses e^+i and divides by n. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = sgn * this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/** Real FFT of size n via one complex FFT of size n/2. Outputs bins 0..n/2 (n/2 + 1 values). */
export class RealFft {
  readonly n: number;
  private half: Fft;
  private zr: Float64Array;
  private zi: Float64Array;
  private wr: Float64Array;
  private wi: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.half = new Fft(n / 2);
    this.zr = new Float64Array(n / 2);
    this.zi = new Float64Array(n / 2);
    this.wr = new Float64Array(n / 2);
    this.wi = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.wr[k] = Math.cos((-2 * Math.PI * k) / n);
      this.wi[k] = Math.sin((-2 * Math.PI * k) / n);
    }
  }

  forward(x: ArrayLike<number>, outRe: Float64Array | Float32Array, outIm: Float64Array | Float32Array): void {
    const h = this.n / 2;
    const zr = this.zr;
    const zi = this.zi;
    for (let i = 0; i < h; i++) { zr[i] = x[2 * i]; zi[i] = x[2 * i + 1]; }
    this.half.transform(zr, zi);
    for (let k = 0; k <= h; k++) {
      const k1 = k % h;
      const k2 = (h - k) % h;
      const er = (zr[k1] + zr[k2]) / 2;
      const ei = (zi[k1] - zi[k2]) / 2;
      const or = (zi[k1] + zi[k2]) / 2;
      const oi = -(zr[k1] - zr[k2]) / 2;
      const wr = k < h ? this.wr[k] : -1;
      const wi = k < h ? this.wi[k] : 0;
      outRe[k] = er + (or * wr - oi * wi);
      outIm[k] = ei + (or * wi + oi * wr);
    }
  }

  /** Inverse of `forward` (bins 0..n/2 in, n real samples out, scaled by 1/n). */
  inverse(re: ArrayLike<number>, im: ArrayLike<number>, out: Float64Array | Float32Array): void {
    const h = this.n / 2;
    const zr = this.zr;
    const zi = this.zi;
    for (let k = 0; k < h; k++) {
      const ar = re[k], ai = im[k];
      const br = re[h - k], bi = -im[h - k];
      const er = (ar + br) / 2, ei = (ai + bi) / 2;
      const dr = (ar - br) / 2, di = (ai - bi) / 2;
      // odd part = d * conj(w)  (w = e^{-2 pi i k / n})
      const wr = this.wr[k], wi = -this.wi[k];
      const or = dr * wr - di * wi;
      const oi = dr * wi + di * wr;
      zr[k] = er - oi;
      zi[k] = ei + or;
    }
    this.half.transform(zr, zi, true);
    for (let i = 0; i < h; i++) { out[2 * i] = zr[i]; out[2 * i + 1] = zi[i]; }
  }
}

/** torch.hann_window(n) (periodic). */
export function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

/** numpy/torch reflect padding. */
export function reflectPad(x: ArrayLike<number>, left: number, right: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n + left + right);
  const at = (i: number) => {
    if (n === 1) return x[0];
    const p = 2 * (n - 1);
    let j = ((i % p) + p) % p;
    if (j >= n) j = p - j;
    return x[j];
  };
  for (let i = 0; i < out.length; i++) out[i] = at(i - left);
  return out;
}

/** Mean of all channels (arithmetic mean, like Beat This!'s Audio2Frames). */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/**
 * Band-limited resampling with a Kaiser-windowed sinc (32 zero crossings each side). Good to
 * about -90 dB; slow-ish but fine for minutes of audio in a background process.
 */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = to / from;
  const n = Math.floor(x.length * ratio);
  const out = new Float32Array(n);
  const cutoff = Math.min(1, ratio) * 0.97;
  const zc = 32;
  const half = Math.ceil(zc / cutoff);
  const beta = 9;
  const i0b = besselI0(beta);
  // Kernel table over t in [-(half+1), half+1], 512 phases per input sample.
  const PH = 512;
  const span = half + 1;
  const tab = new Float32Array(2 * span * PH + 2);
  for (let i = 0; i < tab.length; i++) {
    const t = i / PH - span;
    const u = t / half;
    const win = Math.abs(u) <= 1 ? besselI0(beta * Math.sqrt(1 - u * u)) / i0b : 0;
    const s = t === 0 ? 1 : Math.sin(Math.PI * cutoff * t) / (Math.PI * cutoff * t);
    tab[i] = cutoff * s * win;
  }
  for (let j = 0; j < n; j++) {
    const pos = j / ratio;
    const c = Math.floor(pos);
    const frac = pos - c;
    let acc = 0;
    for (let k = -half; k <= half; k++) {
      const idx = c + k;
      if (idx < 0 || idx >= x.length) continue;
      const f = (k - frac + span) * PH; // k - frac is in (-half-1, half]
      const fi = Math.floor(f);
      acc += x[idx] * (tab[fi] + (tab[fi + 1] - tab[fi]) * (f - fi));
    }
    out[j] = acc;
  }
  return out;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

// ------------------------------------------------------------------ mel

const SLANEY_F_SP = 200 / 3;
const SLANEY_MIN_LOG_HZ = 1000;
const SLANEY_MIN_LOG_MEL = SLANEY_MIN_LOG_HZ / SLANEY_F_SP;
const SLANEY_LOGSTEP = Math.log(6.4) / 27;

export function hzToMelSlaney(f: number): number {
  return f < SLANEY_MIN_LOG_HZ ? f / SLANEY_F_SP : SLANEY_MIN_LOG_MEL + Math.log(f / SLANEY_MIN_LOG_HZ) / SLANEY_LOGSTEP;
}
export function melToHzSlaney(m: number): number {
  return m < SLANEY_MIN_LOG_MEL ? m * SLANEY_F_SP : SLANEY_MIN_LOG_HZ * Math.exp(SLANEY_LOGSTEP * (m - SLANEY_MIN_LOG_MEL));
}

/** torchaudio.functional.melscale_fbanks(norm=None, mel_scale='slaney'): [nFreqs][nMels]. */
export function melFilterbank(nFreqs: number, fMin: number, fMax: number, nMels: number, sampleRate: number): Float32Array {
  const fb = new Float32Array(nFreqs * nMels);
  const allFreqs = new Float64Array(nFreqs);
  for (let i = 0; i < nFreqs; i++) allFreqs[i] = ((sampleRate / 2) * i) / (nFreqs - 1);
  const mMin = hzToMelSlaney(fMin);
  const mMax = hzToMelSlaney(fMax);
  const fPts = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) fPts[i] = melToHzSlaney(mMin + ((mMax - mMin) * i) / (nMels + 1));
  for (let f = 0; f < nFreqs; f++) {
    for (let m = 0; m < nMels; m++) {
      const down = (allFreqs[f] - fPts[m]) / (fPts[m + 1] - fPts[m]);
      const up = (fPts[m + 2] - allFreqs[f]) / (fPts[m + 2] - fPts[m + 1]);
      fb[f * nMels + m] = Math.max(0, Math.min(down, up));
    }
  }
  return fb;
}

/**
 * Beat This! input features: 22050 Hz mono, STFT n_fft 1024 hop 441 periodic Hann centred with
 * reflect padding, |X| / sqrt(n_fft), 128 slaney mels 30..11000 Hz, log1p(1000 x). 50 frames/s.
 * Returns [frames][128] row-major.
 */
export function beatThisFeatures(x22050: Float32Array): { data: Float32Array; frames: number } {
  const nfft = 1024;
  const hop = 441;
  const nMels = 128;
  const nFreqs = nfft / 2 + 1;
  const fb = melFilterbank(nFreqs, 30, 11000, nMels, 22050);
  const padded = reflectPad(x22050, nfft / 2, nfft / 2);
  const frames = 1 + Math.floor(x22050.length / hop);
  const win = hannPeriodic(nfft);
  const fft = new RealFft(nfft);
  const buf = new Float64Array(nfft);
  const re = new Float64Array(nFreqs);
  const im = new Float64Array(nFreqs);
  const mag = new Float64Array(nFreqs);
  const out = new Float32Array(frames * nMels);
  const scale = 1 / Math.sqrt(nfft);
  for (let t = 0; t < frames; t++) {
    const at = t * hop;
    for (let j = 0; j < nfft; j++) buf[j] = (padded[at + j] ?? 0) * win[j];
    fft.forward(buf, re, im);
    for (let f = 0; f < nFreqs; f++) mag[f] = Math.hypot(re[f], im[f]) * scale;
    for (let m = 0; m < nMels; m++) {
      let s = 0;
      for (let f = 0; f < nFreqs; f++) {
        const w = fb[f * nMels + m];
        if (w) s += mag[f] * w;
      }
      out[t * nMels + m] = Math.log1p(1000 * s);
    }
  }
  return { data: out, frames };
}

/** Magnitude spectrogram: [frames][nfft/2+1], Hann window, hop, frames start at 0 (not centred). */
export function magSpectrogram(x: Float32Array, nfft: number, hop: number): { data: Float32Array; frames: number; bins: number } {
  const bins = nfft / 2 + 1;
  const frames = Math.max(0, Math.floor((x.length - nfft) / hop) + 1);
  const win = hannPeriodic(nfft);
  const fft = new RealFft(nfft);
  const buf = new Float64Array(nfft);
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const out = new Float32Array(frames * bins);
  for (let t = 0; t < frames; t++) {
    const at = t * hop;
    for (let j = 0; j < nfft; j++) buf[j] = x[at + j] * win[j];
    fft.forward(buf, re, im);
    for (let f = 0; f < bins; f++) out[t * bins + f] = Math.hypot(re[f], im[f]);
  }
  return { data: out, frames, bins };
}

export function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
