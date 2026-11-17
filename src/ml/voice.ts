// Round 7: a sung melody from a vocal recording. FCPE gives f0 every 10 ms; this turns the f0 track
// into notes (tuning offset, smoothing, pitch-change and syllable-dip splits). Pure.
import type { AudioNote } from '../model/transcribe';

export const VOICE_HOP_S = 0.01;

/** RMS per 10 ms frame (16 kHz, 160 samples), the same grid as FCPE's f0. */
export function frameEnergy(x16k: Float32Array, frames: number): Float32Array {
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * 160 - 80;
    let n = 0;
    for (let i = Math.max(0, a); i < Math.min(x16k.length, a + 320); i++) { s += x16k[i] * x16k[i]; n++; }
    e[f] = n ? Math.sqrt(s / n) : 0;
  }
  return e;
}

export interface VoiceNotesResult { notes: AudioNote[]; centOffset: number; voicedFrames: number }

/**
 * f0 (Hz, 0 = unvoiced) + frame energy -> notes. A new note starts when the pitch moves more than
 * 0.6 semitone for 40 ms, after a gap of 30 ms or more, or at an energy dip between two syllables
 * sung on the same pitch. Notes shorter than 70 ms are dropped.
 */
export function f0ToNotes(f0: Float32Array, energy: Float32Array, opts: { minPitch?: number; maxPitch?: number } = {}): VoiceNotesResult {
  const n = Math.min(f0.length, energy.length);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, energy[i]);
  const gate = peak * 0.03; // -30 dB
  const midi = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const hz = f0[i];
    if (hz > 40 && Number.isFinite(hz) && energy[i] > gate) midi[i] = 69 + 12 * Math.log2(hz / 440);
  }
  // Tuning: circular mean of the cents offsets of the voiced frames (songs not at A440).
  let sx = 0, sy = 0, voiced = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(midi[i])) {
    const a = 2 * Math.PI * (midi[i] - Math.round(midi[i]));
    sx += Math.cos(a); sy += Math.sin(a); voiced++;
  }
  const centOffset = voiced ? Math.round((Math.atan2(sy, sx) / (2 * Math.PI)) * 100) : 0;
  const shift = centOffset / 100;
  // 5-frame median over voiced frames.
  const sm = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(midi[i])) continue;
    const w: number[] = [];
    for (let k = -2; k <= 2; k++) { const v = midi[i + k]; if (v !== undefined && !Number.isNaN(v)) w.push(v); }
    w.sort((a, b) => a - b);
    sm[i] = w[w.length >> 1] - shift;
  }
  // Energy dips (syllable boundaries on the same pitch): local minimum < 55 % of the max around it.
  const dip = new Uint8Array(n);
  for (let i = 3; i < n - 3; i++) {
    if (Number.isNaN(sm[i])) continue;
    let lmax = 0, rmax = 0;
    for (let k = 1; k <= 8; k++) { lmax = Math.max(lmax, energy[i - k] ?? 0); rmax = Math.max(rmax, energy[i + k] ?? 0); }
    if (energy[i] <= energy[i - 1] && energy[i] <= energy[i + 1] && energy[i] < 0.55 * Math.min(lmax, rmax)) dip[i] = 1;
  }
  const notes: AudioNote[] = [];
  let start = -1;
  let frames: number[] = [];
  let away = 0;
  const close = (end: number) => {
    if (start >= 0 && end - start >= 7) {
      const v = frames.slice().sort((a, b) => a - b);
      // The steady middle of the note decides its pitch (skip scoops at both ends).
      const mid = v.length > 6 ? frames.slice(Math.floor(frames.length * 0.25), Math.ceil(frames.length * 0.85)).sort((a, b) => a - b) : v;
      const pitch = Math.round(mid[mid.length >> 1]);
      let amp = 0;
      for (let i = start; i < end; i++) amp = Math.max(amp, energy[i]);
      if (pitch >= (opts.minPitch ?? 0) && pitch <= (opts.maxPitch ?? 127)) notes.push({ startS: start * VOICE_HOP_S, endS: end * VOICE_HOP_S, pitch, amplitude: peak ? amp / peak : 0 });
    }
    start = -1;
    frames = [];
    away = 0;
  };
  let gap = 0;
  for (let i = 0; i < n; i++) {
    const v = sm[i];
    if (Number.isNaN(v)) {
      gap++;
      if (gap >= 3 && start >= 0) close(i - gap + 1);
      continue;
    }
    gap = 0;
    if (start < 0) { start = i; frames = [v]; continue; }
    const cur = frames.slice(-12).sort((a, b) => a - b)[Math.min(frames.length, 12) >> 1];
    if (Math.abs(v - cur) > 0.6) {
      away++;
      if (away >= 4) {
        const at = i - away + 1;
        frames = frames.slice(0, frames.length - (away - 1));
        close(at);
        start = at;
        for (let k = at; k <= i; k++) if (!Number.isNaN(sm[k])) frames.push(sm[k]);
      } else frames.push(v);
      continue;
    }
    away = 0;
    if (dip[i] && i - start >= 10) { close(i); start = i; frames = [v]; continue; }
    frames.push(v);
  }
  close(n);
  return { notes, centOffset, voicedFrames: voiced };
}
