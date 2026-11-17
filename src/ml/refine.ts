// Round 7 item 5: real-song accuracy for bass/guitar transcription (pure, unit-tested).
//  - centOffset: how far the recording sits from A440 (spectral peaks, weighted circular mean), so
//    the audio can be shifted onto the semitone grid before basic-pitch;
//  - fixBassOctaves: basic-pitch often reports a bass note an octave up (the 2nd harmonic is
//    louder than the fundamental on many bass sounds); the stem's own energy at the lower octave decides;
//  - guitarLines: in single-note passages keep one note per onset (drops harmonics), keep chords as chords;
//  - refineOnsets: move each single-note onset to the nearest attack (high-band spectral flux) within
//    ±60 ms (distorted guitar smears basic-pitch's onsets); chords keep their onsets;
//  - detectTuning: standard / Eb / D / drop D / drop C... from the note range.
import { hannPeriodic, RealFft } from './dsp';
import type { AudioNote } from '../model/transcribe';

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Cents (-50..50) the music is tuned away from A440. */
export function centOffset(x: Float32Array, sr: number, fMin = 55, fMax = 1500): { cents: number; peaks: number } {
  const N = 8192;
  const hop = 4096;
  const fft = new RealFft(N);
  const win = hannPeriodic(N);
  const buf = new Float64Array(N);
  const re = new Float64Array(N / 2 + 1);
  const im = new Float64Array(N / 2 + 1);
  const mag = new Float64Array(N / 2 + 1);
  let sx = 0, sy = 0, peaks = 0;
  const lo = Math.floor((fMin * N) / sr);
  const hi = Math.min(N / 2 - 1, Math.ceil((fMax * N) / sr));
  // At most ~600 frames spread over the file.
  const frames = Math.max(1, Math.floor((x.length - N) / hop));
  const step = Math.max(1, Math.floor(frames / 600));
  for (let f = 0; f < frames; f += step) {
    const at = f * hop;
    let e = 0;
    for (let j = 0; j < N; j++) { const v = x[at + j] * win[j]; buf[j] = v; e += v * v; }
    if (e < 1e-6) continue;
    fft.forward(buf, re, im);
    let mx = 0;
    for (let k = lo; k <= hi; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > mx) mx = mag[k]; }
    const floor = mx * 0.1;
    for (let k = lo + 1; k < hi; k++) {
      const a = mag[k - 1], b = mag[k], c = mag[k + 1];
      if (b < floor || b < a || b < c) continue;
      // Parabolic interpolation on log magnitude.
      const la = Math.log(a + 1e-12), lb = Math.log(b), lc = Math.log(c + 1e-12);
      const d = 0.5 * (la - lc) / (la - 2 * lb + lc || 1e-12);
      const freq = ((k + d) * sr) / N;
      const m = 69 + 12 * Math.log2(freq / 440);
      const ang = 2 * Math.PI * (m - Math.round(m));
      const w = b / mx;
      sx += w * Math.cos(ang); sy += w * Math.sin(ang); peaks++;
    }
  }
  const cents = peaks ? (Math.atan2(sy, sx) / (2 * Math.PI)) * 100 : 0;
  return { cents: Math.round(cents * 10) / 10, peaks };
}

/** Goertzel-style energy of a band around `f` (±25 cents) over [a, b) samples. */
function bandEnergy(x: Float32Array, sr: number, a: number, b: number, f: number): number {
  let total = 0;
  for (const c of [-25, 0, 25]) {
    const fr = f * Math.pow(2, c / 1200);
    const w = (2 * Math.PI * fr) / sr;
    const coeff = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    const n = b - a;
    for (let i = a; i < b; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / Math.max(1, n - 1));
      const s0 = x[i] * h + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    total += s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }
  return total;
}

/**
 * Bass notes reported an octave too high: if the stem has a real fundamental an octave below
 * (energy there at least 15 % of the energy at the reported pitch) and the lower note fits on a
 * bass (>= `lowest`), move it down. Also: a note whose pitch is below the bass range moves up.
 */
export function fixBassOctaves(notes: AudioNote[], x: Float32Array, sr: number, lowest = 23): { notes: AudioNote[]; moved: number } {
  let moved = 0;
  const out = notes.map((n) => {
    const a = Math.max(0, Math.round((n.startS + 0.02) * sr));
    const len = Math.min(Math.round(Math.max(0.06, Math.min(0.25, n.endS - n.startS - 0.02)) * sr), x.length - a);
    if (len < sr * 0.04) return n;
    const b = a + len;
    if (n.pitch - 12 >= lowest) {
      const eHere = bandEnergy(x, sr, a, b, hz(n.pitch));
      const eLow = bandEnergy(x, sr, a, b, hz(n.pitch - 12));
      // ... and the lower octave is not just the previous note ringing on.
      if (eLow > 0.15 * eHere && eLow > 1e-9) { moved++; return { ...n, pitch: n.pitch - 12 }; }
    }
    if (n.pitch < lowest) { moved++; return { ...n, pitch: n.pitch + 12 }; }
    return n;
  });
  return { notes: out, moved };
}

/**
 * Guitar: notes starting within 35 ms are one onset. Where onsets around a note mostly have 3+ notes
 * (strummed chords), everything stays; in single-note passages each onset keeps one note: the one
 * that is not an octave / fifth harmonic of a lower note, the loudest otherwise.
 */
export function guitarLines(notes: AudioNote[]): { notes: AudioNote[]; dropped: number; chordOnsets: number; lineOnsets: number } {
  const sorted = notes.slice().sort((a, b) => a.startS - b.startS || a.pitch - b.pitch);
  const groups: AudioNote[][] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.startS - g[0].startS < 0.035) g.push(n);
    else groups.push([n]);
  }
  const out: AudioNote[] = [];
  let chordOnsets = 0, lineOnsets = 0;
  groups.forEach((g, i) => {
    // Neighbourhood: onsets within 1.5 s.
    let big = 0, all = 0;
    for (let k = i - 1; k >= 0 && g[0].startS - groups[k][0].startS < 1.5; k--) { all++; if (groups[k].length >= 3) big++; }
    for (let k = i + 1; k < groups.length && groups[k][0].startS - g[0].startS < 1.5; k++) { all++; if (groups[k].length >= 3) big++; }
    const chordy = g.length >= 3 || (all > 0 && big / all >= 0.5);
    if (chordy || g.length === 1) { out.push(...g); if (chordy) chordOnsets++; else lineOnsets++; return; }
    lineOnsets++;
    const low = g[0];
    const harmonic = (n: AudioNote) => n !== low && [7, 12, 19, 24].includes(n.pitch - low.pitch);
    const keep = g.filter((n) => !harmonic(n));
    const best = keep.reduce((a, b) => (b.amplitude > a.amplitude ? b : a), keep[0] ?? low);
    out.push(best);
  });
  return { notes: out, dropped: notes.length - out.length, chordOnsets, lineOnsets };
}

/** Moves each onset to the strongest high-band (> 1.5 kHz) spectral-flux peak within ±60 ms. */
export function refineOnsets(notes: AudioNote[], x: Float32Array, sr: number, maxShift = 0.06): { notes: AudioNote[]; meanShiftMs: number } {
  const N = 512;
  const hop = 128; // ~2.9 ms at 44.1 kHz
  const fft = new RealFft(N);
  const win = hannPeriodic(N);
  const buf = new Float64Array(N);
  const re = new Float64Array(N / 2 + 1);
  const im = new Float64Array(N / 2 + 1);
  const k0 = Math.floor((1500 * N) / sr);
  const frames = Math.max(0, Math.floor((x.length - N) / hop));
  const flux = new Float32Array(frames);
  let prev = new Float64Array(N / 2 + 1);
  let cur = new Float64Array(N / 2 + 1);
  // Only the frames near notes are needed.
  const need = new Uint8Array(frames + 1);
  for (const n of notes) {
    const a = Math.max(0, Math.floor(((n.startS - maxShift) * sr) / hop) - 1);
    const b = Math.min(frames, Math.ceil(((n.startS + maxShift) * sr) / hop) + 1);
    for (let f = a; f <= b; f++) need[f] = 1;
  }
  for (let f = 0; f < frames; f++) {
    if (!need[f]) { prev.fill(0); continue; }
    for (let j = 0; j < N; j++) buf[j] = x[f * hop + j] * win[j];
    fft.forward(buf, re, im);
    let s = 0;
    for (let k = k0; k <= N / 2; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0 && prev[k] > 0) s += d;
    }
    flux[f] = s;
    [prev, cur] = [cur, prev];
  }
  let shift = 0;
  let moved = 0;
  // Notes starting within 35 ms are one attack (a chord / strum): they move together.
  const order = notes.map((n, i) => ({ n, i })).sort((x, y) => x.n.startS - y.n.startS);
  const out = notes.slice();
  for (let g = 0; g < order.length;) {
    let e = g + 1;
    while (e < order.length && order[e].n.startS - order[g].n.startS < 0.035) e++;
    const group = order.slice(g, e);
    g = e;
    // Chords keep basic-pitch's onset (moving strums to the first attack made our chord renders worse).
    if (group.length > 1) continue;
    const c = (group.reduce((s, x) => s + x.n.startS, 0) / group.length * sr) / hop;
    const a = Math.max(1, Math.floor(c - (maxShift * sr) / hop));
    const b = Math.min(frames - 2, Math.ceil(c + (maxShift * sr) / hop));
    let best = -1, bv = 0;
    for (let f = a; f <= b; f++) if (flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > bv) { bv = flux[f]; best = f; }
    if (best < 0) continue;
    // Frame centre of the attack; a flux frame lags the attack by about half a window.
    const t = (best * hop + N / 2) / sr - 0.004;
    for (const { n, i } of group) {
      shift += Math.abs(t - n.startS);
      moved++;
      out[i] = { ...n, startS: t, endS: Math.max(t + 0.03, n.endS) };
    }
  }
  return { notes: out, meanShiftMs: moved ? Math.round((shift / moved) * 1000 * 10) / 10 : 0 };
}

export interface TuningGuess { name: string; tuning: number[]; lowestNote: number }

const TUNINGS: Record<'bass' | 'guitar', { name: string; tuning: number[] }[]> = {
  bass: [
    { name: 'E standard', tuning: [28, 33, 38, 43] },
    { name: 'Drop D', tuning: [26, 33, 38, 43] },
    { name: 'Eb standard', tuning: [27, 32, 37, 42] },
    { name: 'D standard', tuning: [26, 31, 36, 41] },
    { name: 'Drop C#', tuning: [25, 32, 37, 42] },
    { name: 'Drop C', tuning: [24, 31, 36, 41] },
    { name: 'C standard', tuning: [24, 29, 34, 39] },
  ],
  guitar: [
    { name: 'E standard', tuning: [40, 45, 50, 55, 59, 64] },
    { name: 'Drop D', tuning: [38, 45, 50, 55, 59, 64] },
    { name: 'Eb standard', tuning: [39, 44, 49, 54, 58, 63] },
    { name: 'D standard', tuning: [38, 43, 48, 53, 57, 62] },
    { name: 'Drop C#', tuning: [37, 44, 49, 54, 58, 63] },
    { name: 'Drop C', tuning: [36, 43, 48, 53, 57, 62] },
    { name: 'C standard', tuning: [36, 41, 46, 51, 55, 60] },
  ],
};

/**
 * Tuning from the notes: the lowest notes that are really used (2nd percentile, at least 3 notes)
 * must be playable; among the tunings that allow them, prefer the one whose open strings get the
 * most notes (riffs on open strings) and then standard tunings.
 */
export function detectTuning(notes: { pitch: number }[], kind: 'bass' | 'guitar'): TuningGuess {
  const list = TUNINGS[kind];
  if (!notes.length) return { ...list[0], lowestNote: 0 };
  const ps = notes.map((n) => n.pitch).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const p of ps) counts.set(p, (counts.get(p) ?? 0) + 1);
  // Lowest pitch used at least 3 times / 0.5 % of the notes.
  let low = ps[0];
  for (const p of [...counts.keys()].sort((a, b) => a - b)) if ((counts.get(p) ?? 0) >= Math.max(3, ps.length * 0.005)) { low = p; break; }
  // Nothing below the standard lowest string: standard tuning (a lower tuning cannot be told apart).
  if (low >= list[0].tuning[0]) return { ...list[0], lowestNote: low };
  let best = list[0], bs = -Infinity;
  list.forEach((t, i) => {
    if (t.tuning[0] > low) return;
    const open = t.tuning.reduce((s, p) => s + (counts.get(p) ?? 0), 0) / ps.length;
    // The lowest string should be close to the lowest note (no unused low strings).
    const gap = low - t.tuning[0];
    const s = open * 2 - gap * 0.15 - i * 0.01 + (gap <= 2 ? 0.3 : 0);
    if (s > bs) { bs = s; best = t; }
  });
  return { ...best, lowestNote: low };
}
