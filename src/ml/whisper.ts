// Round 7: Whisper (speech to text) host code for the onnx-community whisper-base_timestamped
// export: log-mel features, greedy decoding (English, no timestamp tokens), and word timings from
// the decoder's cross-attentions on the alignment heads with dynamic time warping, as in OpenAI's
// whisper/timing.py. Pure: the model runs are callbacks.
import { melFilterbank, hannPeriodic, reflectPad } from './dsp';

export const W_SR = 16000;
const NFFT = 400;
const HOP = 160;
const NMELS = 80;
const FRAMES = 3000; // 30 s
export const TOK = { eot: 50257, sot: 50258, en: 50259, transcribe: 50359, notimestamps: 50363, timestamp0: 50364 } as const;
/** generation_config alignment_heads of whisper-base: [layer, head]. */
export const ALIGNMENT_HEADS: [number, number][] = [[3, 1], [4, 2], [4, 3], [4, 7], [5, 1], [5, 2], [5, 4], [5, 6]];

let melFb: Float32Array | null = null;
let cosT: Float64Array | null = null;
let sinT: Float64Array | null = null;

/** 80 x 3000 log-mel of up to 30 s of 16 kHz audio (zero-padded), Whisper's normalisation. */
export function whisperMel(x: Float32Array): Float32Array {
  const nF = NFFT / 2 + 1;
  if (!melFb) {
    // librosa.filters.mel(sr=16000, n_fft=400, n_mels=80): slaney scale + slaney (area) norm.
    const fb = melFilterbank(nF, 0, 8000, NMELS, W_SR);
    // Area normalisation: 2 / (f[m+2] - f[m]) with the same mel points.
    const mMin = 0;
    const mMax = hzToMel(8000);
    for (let m = 0; m < NMELS; m++) {
      const lo = melToHz(mMin + ((mMax - mMin) * m) / (NMELS + 1));
      const hi = melToHz(mMin + ((mMax - mMin) * (m + 2)) / (NMELS + 1));
      const k = 2 / (hi - lo);
      for (let f = 0; f < nF; f++) fb[f * NMELS + m] *= k;
    }
    melFb = fb;
    cosT = new Float64Array(nF * NFFT);
    sinT = new Float64Array(nF * NFFT);
    for (let f = 0; f < nF; f++) for (let j = 0; j < NFFT; j++) {
      cosT[f * NFFT + j] = Math.cos((2 * Math.PI * f * j) / NFFT);
      sinT[f * NFFT + j] = Math.sin((2 * Math.PI * f * j) / NFFT);
    }
  }
  const n = FRAMES * HOP;
  const audio = new Float32Array(n);
  audio.set(x.subarray(0, n));
  const padded = reflectPad(audio, NFFT / 2, NFFT / 2);
  const win = hannPeriodic(NFFT);
  const out = new Float32Array(NMELS * FRAMES);
  const buf = new Float64Array(NFFT);
  const pow = new Float64Array(nF);
  let maxV = -Infinity;
  // Frames past the audio are silence (log10(1e-10)); compute only the real ones.
  const real = Math.min(FRAMES, Math.ceil(x.length / HOP) + 1);
  for (let t = 0; t < FRAMES; t++) {
    if (t >= real) {
      for (let m = 0; m < NMELS; m++) out[m * FRAMES + t] = -10;
      continue;
    }
    for (let j = 0; j < NFFT; j++) buf[j] = padded[t * HOP + j] * win[j];
    for (let f = 0; f < nF; f++) {
      let re = 0, im = 0;
      const o = f * NFFT;
      for (let j = 0; j < NFFT; j++) { re += buf[j] * cosT![o + j]; im -= buf[j] * sinT![o + j]; }
      pow[f] = re * re + im * im;
    }
    for (let m = 0; m < NMELS; m++) {
      let s = 0;
      for (let f = 0; f < nF; f++) s += pow[f] * melFb[f * NMELS + m];
      const v = Math.log10(Math.max(1e-10, s));
      out[m * FRAMES + t] = v;
      if (v > maxV) maxV = v;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], maxV - 8) + 4) / 4;
  return out;
}

function hzToMel(f: number) {
  const fsp = 200 / 3;
  return f < 1000 ? f / fsp : 1000 / fsp + Math.log(f / 1000) / (Math.log(6.4) / 27);
}
function melToHz(m: number) {
  const fsp = 200 / 3;
  const minLogMel = 1000 / fsp;
  return m < minLogMel ? m * fsp : 1000 * Math.exp((Math.log(6.4) / 27) * (m - minLogMel));
}

// ------------------------------------------------------------------ tokens

/** GPT-2 byte-level BPE: token strings -> bytes -> UTF-8 text. */
export function makeDecoder(vocab: Record<string, number>): (ids: number[]) => string {
  const inv = new Map<number, string>();
  for (const [k, v] of Object.entries(vocab)) inv.set(v, k);
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const byteOf = new Map<string, number>();
  bs.forEach((b, i) => byteOf.set(String.fromCharCode(cs[i]), b));
  return (ids) => {
    const bytes: number[] = [];
    for (const id of ids) {
      const s = inv.get(id);
      if (!s) continue;
      for (const ch of s) { const b = byteOf.get(ch); if (b !== undefined) bytes.push(b); }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  };
}

// ------------------------------------------------------------------ decoding + word timings

export interface WhisperWord { word: string; start: number; end: number; prob: number }

export interface WhisperModels {
  encode: (mel: Float32Array) => Promise<{ data: Float32Array; dims: readonly number[] }>;
  /** Decoder over the whole token sequence: logits [T, V] (last row used) + cross-attentions per layer [heads, T, 1500]. */
  decode: (ids: number[], enc: { data: Float32Array; dims: readonly number[] }) => Promise<{ logits: Float32Array; vocab: number; cross: Float32Array[]; heads: number }>;
  decodeText: (ids: number[]) => string;
}

function medianFilter(x: Float64Array, w: number): Float64Array {
  const h = w >> 1;
  const out = new Float64Array(x.length);
  const tmp: number[] = [];
  for (let i = 0; i < x.length; i++) {
    tmp.length = 0;
    for (let k = -h; k <= h; k++) {
      let j = i + k;
      if (j < 0) j = -j;
      if (j >= x.length) j = 2 * x.length - 2 - j;
      tmp.push(x[Math.max(0, Math.min(x.length - 1, j))]);
    }
    tmp.sort((a, b) => a - b);
    out[i] = tmp[h];
  }
  return out;
}

/** DTW over a cost matrix [N][M] (whisper/timing.py dtw_cpu + backtrace): returns text index and time index paths. */
function dtw(cost: Float64Array, N: number, M: number): { ti: number[]; tj: number[] } {
  const C = new Float64Array((N + 1) * (M + 1)).fill(Infinity);
  const T = new Int8Array((N + 1) * (M + 1)).fill(-1);
  C[0] = 0;
  for (let j = 1; j <= M; j++) for (let i = 1; i <= N; i++) {
    const c0 = C[(i - 1) * (M + 1) + j - 1], c1 = C[(i - 1) * (M + 1) + j], c2 = C[i * (M + 1) + j - 1];
    let c: number, t: number;
    if (c0 < c1 && c0 < c2) { c = c0; t = 0; } else if (c1 < c0 && c1 < c2) { c = c1; t = 1; } else { c = c2; t = 2; }
    C[i * (M + 1) + j] = cost[(i - 1) * M + j - 1] + c;
    T[i * (M + 1) + j] = t;
  }
  let i = N, j = M;
  for (let k = 0; k <= M; k++) T[k] = 2;
  for (let k = 0; k <= N; k++) T[k * (M + 1)] = 1;
  const ti: number[] = [], tj: number[] = [];
  while (i > 0 || j > 0) {
    ti.push(i - 1); tj.push(j - 1);
    const t = T[i * (M + 1) + j];
    if (t === 0) { i--; j--; } else if (t === 1) i--; else j--;
  }
  return { ti: ti.reverse(), tj: tj.reverse() };
}

/** Transcribes up to 30 s (offset in s is added to the times). Greedy, English, no timestamp tokens. */
export async function whisperChunk(m: WhisperModels, x16k: Float32Array, offsetS: number): Promise<WhisperWord[]> {
  const mel = whisperMel(x16k);
  const enc = await m.encode(mel);
  const prompt: number[] = [TOK.sot, TOK.en, TOK.transcribe, TOK.notimestamps];
  const ids = prompt.slice();
  const probs: number[] = [];
  let last: Awaited<ReturnType<WhisperModels['decode']>> | null = null;
  for (let step = 0; step < 120; step++) {
    const r = await m.decode(ids, enc);
    last = r;
    const V = r.vocab;
    const row = r.logits.subarray((ids.length - 1) * V, ids.length * V);
    let best = -1, bv = -Infinity, sum = 0;
    let mx = -Infinity;
    for (let v = 0; v < V; v++) if (row[v] > mx) mx = row[v];
    for (let v = 0; v < V; v++) {
      sum += Math.exp(row[v] - mx);
      // Text tokens and end-of-text only (no other special tokens, no blank first token).
      if (v > TOK.eot) continue;
      if (step === 0 && v === TOK.eot) continue;
      if (row[v] > bv) { bv = row[v]; best = v; }
    }
    probs.push(Math.exp(bv - mx) / sum);
    if (best === TOK.eot || best < 0) break;
    ids.push(best);
    // Stop on a loop of the same 4 tokens (hallucination guard).
    if (ids.length > 12 && ids.slice(-4).join() === ids.slice(-8, -4).join() && ids.slice(-4).join() === ids.slice(-12, -8).join()) break;
  }
  const text = ids.slice(prompt.length);
  if (!text.length || !last) return [];
  // Word timings: cross-attention of the alignment heads over [prompt + text + eot].
  const full = [...ids, TOK.eot];
  const r = await m.decode(full, enc);
  const nTok = full.length;
  const nFrames = Math.min(1500, Math.ceil(x16k.length / 320));
  const H = r.heads;
  const weights: Float64Array[] = [];
  for (const [layer, head] of ALIGNMENT_HEADS) {
    const a = r.cross[layer];
    if (!a) continue;
    const w = new Float64Array(nTok * nFrames);
    const per = a.length / H / nTok; // 1500
    for (let t = 0; t < nTok; t++) for (let f = 0; f < nFrames; f++) w[t * nFrames + f] = a[(head * nTok + t) * per + f];
    // Standardise over the token axis (whisper/timing.py: std_mean(dim=-2)), then a width-7 median filter over time.
    for (let f = 0; f < nFrames; f++) {
      let mean = 0;
      for (let t = 0; t < nTok; t++) mean += w[t * nFrames + f];
      mean /= nTok;
      let v = 0;
      for (let t = 0; t < nTok; t++) v += (w[t * nFrames + f] - mean) ** 2;
      const sd = Math.sqrt(v / nTok) || 1;
      for (let t = 0; t < nTok; t++) w[t * nFrames + f] = (w[t * nFrames + f] - mean) / sd;
    }
    for (let t = 0; t < nTok; t++) w.set(medianFilter(w.subarray(t * nFrames, (t + 1) * nFrames) as Float64Array, 7), t * nFrames);
    weights.push(w);
  }
  if (!weights.length) return [];
  // Average heads, keep the text rows (+ eot), DTW on -weights.
  const s0 = prompt.length;
  const N = nTok - s0 - 1; // text tokens (whisper drops the eot row)
  const cost = new Float64Array(N * nFrames);
  for (let t = 0; t < N; t++) for (let f = 0; f < nFrames; f++) {
    let s = 0;
    for (const w of weights) s += w[(t + s0) * nFrames + f];
    cost[t * nFrames + f] = -s / weights.length;
  }
  const { ti, tj } = dtw(cost, N, nFrames);
  // Token start times: first DTW step where the text index advances.
  const starts: number[] = [];
  for (let k = 0; k < ti.length; k++) if (k === 0 || ti[k] !== ti[k - 1]) starts.push(tj[k] * 0.02);
  // Words: tokens whose text starts with a space begin a new word.
  const words: WhisperWord[] = [];
  let cur: { toks: number[]; start: number; probs: number[] } | null = null;
  const flush = (endT: number) => {
    if (!cur) return;
    const w = m.decodeText(cur.toks).trim();
    if (w) words.push({ word: w, start: offsetS + cur.start, end: offsetS + endT, prob: cur.probs.reduce((a, b) => a + b, 0) / cur.probs.length });
    cur = null;
  };
  text.forEach((id, k) => {
    const piece = m.decodeText([id]);
    const t = starts[k] ?? starts[starts.length - 1];
    if (!cur || /^\s/.test(piece)) { flush(t); cur = { toks: [], start: t, probs: [] }; }
    cur!.toks.push(id);
    cur!.probs.push(probs[k] ?? 0);
  });
  let lastEnd = 0;
  for (let k = 0; k < ti.length; k++) if (ti[k] === N - 1) lastEnd = Math.max(lastEnd, tj[k] * 0.02 + 0.02);
  flush(lastEnd || nFrames * 0.02);
  return words;
}

/** Whole recording: 30 s windows (cut at the quietest point of the last 5 s), words in time order. */
export async function whisperWords(m: WhisperModels, x16k: Float32Array, onProgress?: (d: number, t: number) => void): Promise<WhisperWord[]> {
  const out: WhisperWord[] = [];
  let at = 0;
  const total = x16k.length;
  while (at < total - W_SR * 0.5) {
    let end = Math.min(total, at + 30 * W_SR);
    if (end < total) {
      // Cut in the quietest 100 ms of the window's last 5 s (between words).
      let bestE = Infinity, bestAt = end;
      for (let s = end - 5 * W_SR; s + 1600 <= end; s += 800) {
        let e = 0;
        for (let i = s; i < s + 1600; i++) e += x16k[i] * x16k[i];
        if (e < bestE) { bestE = e; bestAt = s + 800; }
      }
      end = bestAt;
    }
    const words = await whisperChunk(m, x16k.subarray(at, end), at / W_SR);
    out.push(...words);
    onProgress?.(end, total);
    at = end;
  }
  return out;
}
