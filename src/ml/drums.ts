// Drum transcription without a model (no usable free drum-transcription ONNX model exists):
// onset detection on band energies, then each onset is labelled from how much each band rose
// and how fast the cymbal band decays. Thresholds adapt to the song (Otsu split of each band's
// rises). Kick, snare, hi-hat closed/open, toms (low/mid/high), crash and ride. Pure.
import { magSpectrogram, RealFft } from './dsp';

export type DrumPiece = 'kick' | 'snare' | 'hhClosed' | 'hhOpen' | 'tomLow' | 'tomMid' | 'tomHigh' | 'crash' | 'ride';

export interface DrumHit {
  /** seconds */
  t: number;
  piece: DrumPiece;
  /** 0..1 */
  vel: number;
}

/** General MIDI drum notes for each piece. */
export const DRUM_GM: Record<DrumPiece, number> = {
  kick: 36, snare: 38, hhClosed: 42, hhOpen: 46, tomLow: 45, tomMid: 47, tomHigh: 50, crash: 49, ride: 51,
};

/** GM drum note -> piece (for scoring transcriptions against known notes). */
export function pieceOfGm(n: number): DrumPiece | null {
  if (n === 35 || n === 36) return 'kick';
  if (n === 37 || n === 38 || n === 39 || n === 40) return 'snare';
  if (n === 42 || n === 44) return 'hhClosed';
  if (n === 46) return 'hhOpen';
  if (n === 41 || n === 43 || n === 45) return 'tomLow';
  if (n === 47 || n === 48) return 'tomMid';
  if (n === 50) return 'tomHigh';
  if (n === 49 || n === 52 || n === 55 || n === 57) return 'crash';
  if (n === 51 || n === 53 || n === 59) return 'ride';
  return null;
}

const BANDS: [number, number][] = [
  [30, 110], // 0 sub: kick
  [110, 300], // 1 low: toms, snare body
  [300, 1500], // 2 mid
  [1500, 6000], // 3 high-mid: snare noise, crash, ride
  [6000, 16000], // 4 high: hats, cymbals
  [2500, 6000], // 5 upper-mid (snare noise peak)
  [9000, 16000], // 6 top (hi-hat sizzle)
];

function otsu(values: number[], lo: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 4) return lo;
  let best = lo, bestScore = -1;
  for (let k = 1; k < v.length; k++) {
    const a = v.slice(0, k), b = v.slice(k);
    const ma = a.reduce((s, x) => s + x, 0) / a.length;
    const mb = b.reduce((s, x) => s + x, 0) / b.length;
    const score = a.length * b.length * (ma - mb) * (ma - mb);
    if (score > bestScore) { bestScore = score; best = (v[k - 1] + v[k]) / 2; }
  }
  return Math.max(lo, best);
}

export interface DrumDebug {
  onsets: { t: number; rise: number[]; post: number[]; decay: number; hiCentroid: number; lowPeakHz: number }[];
  thr: number[];
}

export function transcribeDrums(x: Float32Array, sr: number, debug?: DrumDebug): DrumHit[] {
  const nfft = sr > 32000 ? 1024 : 512;
  const hop = Math.round(sr / 344); // ~2.9 ms
  const spec = magSpectrogram(x, nfft, hop);
  const { frames, bins } = spec;
  if (frames < 8) return [];
  const binHz = sr / nfft;
  const B = BANDS.length;
  const E = BANDS.map(() => new Float32Array(frames));
  const hiCent = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let cw = 0, cs = 0;
    for (let f = 1; f < bins; f++) {
      const hz = f * binHz;
      const m = spec.data[t * bins + f];
      const p = m * m;
      for (let b = 0; b < B; b++) if (hz >= BANDS[b][0] && hz < BANDS[b][1]) E[b][t] += p;
      if (hz >= 1500 && hz < 16000) { cw += p; cs += p * hz; }
    }
    hiCent[t] = cw > 0 ? cs / cw : 0;
  }
  const dB = E.map((e) => Float32Array.from(e, (v) => 10 * Math.log10(v + 1e-10)));
  // Frame time = window centre.
  const frameT = (t: number) => (t * hop + nfft / 2) / sr;
  const ms = (m: number) => Math.max(1, Math.round((m / 1000) * sr / hop));

  // Onset strength: summed positive rise (lag 2 frames) across bands, weighted equally in dB.
  const odf = new Float32Array(frames);
  for (let t = 3; t < frames; t++) {
    let s = 0;
    for (let b = 0; b < B; b++) s += Math.max(0, dB[b][t] - Math.max(dB[b][t - 2], dB[b][t - 3]));
    odf[t] = s;
  }
  // Floors: a band must reach within 30 dB of its loud level to count.
  const p97 = dB.map((d) => { const s = Array.from(d).sort((a, b) => a - b); return s[Math.floor(s.length * 0.97)]; });
  const peaks: number[] = [];
  const w = ms(25);
  const meanWin = ms(400);
  for (let t = 3; t < frames - 3; t++) {
    let isMax = true;
    for (let j = Math.max(0, t - w); j <= Math.min(frames - 1, t + w); j++) if (odf[j] > odf[t]) { isMax = false; break; }
    if (!isMax || odf[t] < 4) continue;
    let mean = 0, c = 0;
    for (let j = Math.max(0, t - meanWin); j < Math.min(frames, t + meanWin); j++) { mean += odf[j]; c++; }
    if (odf[t] < (mean / c) * 1.3 + 2) continue;
    if (peaks.length && t - peaks[peaks.length - 1] < ms(30)) continue;
    peaks.push(t);
  }

  const avg = (b: number, a: number, z: number) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, a); j < Math.min(frames, z); j++) { s += E[b][j]; c++; }
    return 10 * Math.log10(s / Math.max(1, c) + 1e-10);
  };
  const ons = peaks.map((t) => {
    // The onset frame is where the rise is steepest; "pre" ends before it, "post" starts at it.
    const pre = BANDS.map((_, b) => avg(b, t - ms(25), t - ms(4)));
    const post = BANDS.map((_, b) => avg(b, t, t + ms(30)));
    const rise = post.map((p, b) => Math.max(0, p - Math.max(pre[b], p97[b] - 45)));
    const later = avg(4, t + ms(110), t + ms(150));
    const decay = post[4] - later;
    let c = 0, k = 0;
    for (let j = t; j < Math.min(frames, t + ms(30)); j++) { c += hiCent[j]; k++; }
    // Drum pitch: strongest frequency 35..400 Hz in the first 120 ms (zero-padded long FFT, ~1.3 Hz bins).
    const pf = lowPitch(x, Math.max(0, Math.round(frameT(t) * sr - nfft / 4)), sr);
    return { t, time: frameT(t), rise, post, decay, hiCentroid: c / Math.max(1, k), lowPeakHz: pf, odf: odf[t] };
  });

  // Onsets where no band rose by 5 dB are noise (decaying cymbal wash, sample loops).
  const real = ons.filter((o) => Math.max(...o.rise) >= 5);
  ons.length = 0;
  ons.push(...real);
  // Per-band "it rose" thresholds from this song's onsets; the cymbal bands are capped (busy hats
  // and kicks clicking into the top band can push the split far too high).
  const thr = BANDS.map((_, b) => {
    const v = otsu(ons.map((o) => o.rise[b]), b >= 4 ? 4 : 6);
    return b >= 4 ? Math.min(v, 12) : v;
  });
  if (debug) {
    debug.thr = thr;
    debug.onsets = ons.map((o) => ({ t: o.time, rise: o.rise.map((v) => +v.toFixed(1)), post: o.post.map((v) => +v.toFixed(1)), decay: +o.decay.toFixed(1), hiCentroid: Math.round(o.hiCentroid), lowPeakHz: Math.round(o.lowPeakHz) }));
  }
  const loud = Math.max(...ons.map((o) => o.odf), 1);
  const hits: DrumHit[] = [];
  const toms: { hit: number; hz: number }[] = [];
  for (const o of ons) {
    const vel = Math.max(0.2, Math.min(1, o.odf / loud));
    const [rSub, rLow, rMid, rHm, rHi] = o.rise;
    const add = (piece: DrumPiece) => hits.push({ t: +o.time.toFixed(4), piece, vel });
    const [pSub, pLow, , , , pUp, pTop] = o.post;
    const [rUp] = [o.rise[5]];
    void rMid; void rHm;
    // Top minus upper-mid: hi-hat sizzle (9-16 kHz) against snare/cymbal noise (2.5-6 kHz).
    const T = pTop - pUp;
    // Kick: the sub band rises and dominates the low band; pitch under 70 Hz.
    const kick = rSub > thr[0] && pSub >= pLow - 3 && o.lowPeakHz < 70;
    // A drum body above the sub band (snare ~200 Hz, toms 80-200 Hz).
    const body = !kick && (rLow > thr[1] || rSub > thr[0] || rUp > thr[5]) && pLow > p97[1] - 18 && (pLow - pSub > 3 || o.lowPeakHz >= 70);
    // Snare wires add noise up to the top band; toms are dark (no top).
    const tom = body && T < -20;
    const snare = body && !tom;
    if (kick) add('kick');
    if (snare) add('snare');
    if (tom) toms.push({ hit: hits.length, hz: o.lowPeakHz }), add('tomMid');
    // Cymbals: a crash keeps swelling (energy 110-150 ms later is not lower).
    if (o.decay < -2 && rHi > 2 && pUp > p97[5] - 12) add('crash');
    else {
      const alone = !kick && !snare && !tom;
      const topOn = pTop > p97[6] - 25;
      const hat = topOn && (snare ? T > -9 : kick ? T > -15.5 : rHi > thr[4] && T > -8);
      if (hat && alone && o.hiCentroid < 7000) add('ride');
      else if (hat) add(!snare && o.decay <= 12 ? 'hhOpen' : 'hhClosed');
      else if (alone && rUp > thr[5] && T < -15) add('ride');
    }
  }
  // Toms low/mid/high by pitch, relative to the toms in this song.
  if (toms.length) {
    const hz = [...new Set(toms.map((t) => Math.round(t.hz / 8)))].sort((a, b) => a - b);
    for (const t of toms) {
      const i = hz.indexOf(Math.round(t.hz / 8));
      const rank = hz.length === 1 ? 1 : i / (hz.length - 1);
      hits[t.hit].piece = rank < 0.34 ? 'tomLow' : rank < 0.67 ? 'tomMid' : 'tomHigh';
    }
  }
  return hits;
}

const PITCH_N = 32768;
let pitchFft: RealFft | null = null;
function lowPitch(x: Float32Array, at: number, sr: number): number {
  const len = Math.min(Math.round(0.12 * sr), x.length - at);
  if (len < 64) return 0;
  pitchFft ??= new RealFft(PITCH_N);
  const buf = new Float64Array(PITCH_N);
  for (let i = 0; i < len; i++) buf[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
  const re = new Float64Array(PITCH_N / 2 + 1), im = new Float64Array(PITCH_N / 2 + 1);
  pitchFft.forward(buf, re, im);
  const hz = sr / PITCH_N;
  let best = 0, bm = -1;
  for (let f = Math.ceil(35 / hz); f * hz < 400; f++) {
    const m = re[f] * re[f] + im[f] * im[f];
    if (m > bm) { bm = m; best = f; }
  }
  return best * hz;
}

/** Note F-score with an onset tolerance (seconds). Items match one-to-one, greedily by time. */
export function fScore<T extends { t: number }>(ref: T[], est: T[], tol: number, same: (a: T, b: T) => boolean = () => true) {
  const used = new Uint8Array(est.length);
  let tp = 0;
  const sorted = est.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t);
  for (const r of ref) {
    let best = -1, bd = tol + 1e-9;
    for (const { e, i } of sorted) {
      if (used[i] || !same(r, e)) continue;
      const d = Math.abs(e.t - r.t);
      if (d <= bd) { bd = d; best = i; }
      if (e.t > r.t + tol) break;
    }
    if (best >= 0) { used[best] = 1; tp++; }
  }
  const p = est.length ? tp / est.length : ref.length ? 0 : 1;
  const r = ref.length ? tp / ref.length : est.length ? 0 : 1;
  return { f: p + r ? (2 * p * r) / (p + r) : 0, p, r, tp, ref: ref.length, est: est.length };
}
