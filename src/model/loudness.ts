// Loudness (ITU-R BS.1770-4 / EBU R128 integrated loudness, LUFS) and a look-ahead peak limiter.
// Pure functions over interleaved stereo Float32 samples, so they run in unit tests and in the app.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** BS.1770 K-weighting (pre-filter shelf + RLB high pass) for any sample rate (libebur128's formulas). */
function kWeighting(sr: number): Biquad[] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087613982;
  Q = 0.5003270373253953;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

function filterChannel(x: Float32Array | Float64Array, ch: number, stride: number, fs: Biquad[]): Float64Array {
  const n = Math.floor(x.length / stride);
  let y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i * stride + ch];
  for (const f of fs) {
    const out = new Float64Array(n);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const v = y[i];
      const o = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o;
      out[i] = o;
    }
    y = out;
  }
  return y;
}

/** Integrated loudness in LUFS of interleaved stereo (or mono with channels = 1). -Infinity for silence. */
export function integratedLoudness(samples: Float32Array, sampleRate: number, channels = 2): number {
  const fs = kWeighting(sampleRate);
  const ys: Float64Array[] = [];
  for (let c = 0; c < channels; c++) ys.push(filterChannel(samples, c, channels, fs));
  const n = ys[0].length;
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  if (n < block) return -Infinity;
  // Prefix sums of squares per channel for fast block energies.
  const pre = ys.map((y) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + y[i] * y[i];
    return p;
  });
  const z: number[] = [];
  for (let s = 0; s + block <= n; s += step) {
    let sum = 0;
    for (const p of pre) sum += (p[s + block] - p[s]) / block;
    z.push(sum);
  }
  const lk = (e: number) => -0.691 + 10 * Math.log10(e);
  const abs = z.filter((e) => e > 0 && lk(e) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((e) => lk(e) > rel);
  if (!gated.length) return -Infinity;
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function peakOf(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > p) p = v;
  }
  return p;
}

/**
 * Look-ahead peak limiter (in place): no sample ends above `ceilingDb`. The gain reduction starts
 * `lookaheadMs` before a peak (smoothly) and recovers with `releaseMs`.
 */
export function limitPeaks(samples: Float32Array, sampleRate: number, ceilingDb = -1, lookaheadMs = 5, releaseMs = 80, channels = 2): Float32Array {
  const ceil = Math.pow(10, ceilingDb / 20);
  const n = Math.floor(samples.length / channels);
  const W = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  // Gain each frame needs on its own.
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let c = 0; c < channels; c++) p = Math.max(p, Math.abs(samples[i * channels + c]));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // Sliding minimum over the next W frames (monotonic deque).
  const smin = new Float32Array(n);
  const dq = new Int32Array(n + W + 1);
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && need[dq[t - 1]] >= need[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + W) h++;
    smin[i] = need[dq[h]];
  }
  // Release: gain may rise back toward 1 only slowly.
  const rel = Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate));
  let g = 1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    g = Math.min(smin[i], 1 - (1 - g) * rel);
    env[i] = g;
  }
  // Moving average over the look-ahead window: smooth, and still <= what every frame needs.
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i];
    if (i >= W) acc -= env[i - W];
    const avg = acc / Math.min(i + 1, W);
    const gain = Math.min(avg, need[i]);
    for (let c = 0; c < channels; c++) samples[i * channels + c] *= gain;
  }
  return samples;
}

/** Scale to a target loudness (LUFS), then limit peaks to `ceilingDb`. Returns the measured values. */
export function normalizeLoudness(samples: Float32Array, sampleRate: number, targetLufs = -14, ceilingDb = -1): { before: number; after: number; gainDb: number } {
  const before = integratedLoudness(samples, sampleRate);
  if (!isFinite(before)) return { before, after: before, gainDb: 0 };
  let total = 0;
  let now = before;
  // Limiting can pull the loudness down a little: correct up to three times.
  for (let k = 0; k < 3 && Math.abs(now - targetLufs) > 0.2; k++) {
    const gdb = targetLufs - now;
    const g = Math.pow(10, gdb / 20);
    for (let i = 0; i < samples.length; i++) samples[i] *= g;
    total += gdb;
    limitPeaks(samples, sampleRate, ceilingDb);
    now = integratedLoudness(samples, sampleRate);
  }
  if (peakOf(samples) > Math.pow(10, ceilingDb / 20)) limitPeaks(samples, sampleRate, ceilingDb);
  return { before, after: now, gainDb: total };
}
