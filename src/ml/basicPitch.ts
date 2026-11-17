// basic-pitch (Spotify, Apache-2.0) host code: windowing of the audio for the ONNX model and the
// note decoding (output_to_notes_polyphonic + melodia trick), ported from basic_pitch v0.4.0
// inference.py / note_creation.py. Pure: the model call is passed in.

export const BP_SR = 22050;
const FFT_HOP = 256;
const AUDIO_N_SAMPLES = BP_SR * 2 - FFT_HOP; // 43844
const ANNOT_FPS = Math.floor(BP_SR / FFT_HOP); // 86
const ANNOT_N_FRAMES = ANNOT_FPS * 2; // 172
const N_OVERLAP_FRAMES = 30;
const OVERLAP_LEN = N_OVERLAP_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LEN;
const MIDI_OFFSET = 21;
const N_PITCH = 88;

/** One window [1, 43844, 1] -> note [172][88], onset [172][88] (row-major). */
export type BpRun = (window: Float32Array) => Promise<{ note: Float32Array; onset: Float32Array }>;

export interface BpOutput {
  frames: number;
  note: Float32Array;
  onset: Float32Array;
}

export async function runBasicPitch(x22050: Float32Array, run: BpRun, progress?: (d: number, t: number) => void, cancelled?: () => boolean): Promise<BpOutput> {
  const origLen = x22050.length;
  const audio = new Float32Array(origLen + OVERLAP_LEN / 2);
  audio.set(x22050, OVERLAP_LEN / 2);
  const starts: number[] = [];
  for (let i = 0; i < audio.length; i += HOP_SIZE) starts.push(i);
  const nOlap = N_OVERLAP_FRAMES / 2;
  const keep = ANNOT_N_FRAMES - 2 * nOlap;
  const total = Math.floor(origLen * (ANNOT_FPS / BP_SR));
  const note = new Float32Array(Math.max(total, 0) * N_PITCH);
  const onset = new Float32Array(note.length);
  let row = 0;
  const win = new Float32Array(AUDIO_N_SAMPLES);
  for (let w = 0; w < starts.length; w++) {
    if (cancelled?.()) throw new Error('Cancelled');
    win.fill(0);
    win.set(audio.subarray(starts[w], starts[w] + AUDIO_N_SAMPLES));
    const r = await run(win);
    for (let f = nOlap; f < nOlap + keep && row < total; f++, row++) {
      note.set(r.note.subarray(f * N_PITCH, (f + 1) * N_PITCH), row * N_PITCH);
      onset.set(r.onset.subarray(f * N_PITCH, (f + 1) * N_PITCH), row * N_PITCH);
    }
    progress?.(w + 1, starts.length);
  }
  return { frames: total, note, onset };
}

/** Frame index -> seconds (basic-pitch's model_frames_to_time, magic window offset included). */
export function frameTime(i: number): number {
  const t = (i * FFT_HOP) / BP_SR;
  const windowOffset = (FFT_HOP / BP_SR) * (ANNOT_N_FRAMES - AUDIO_N_SAMPLES / FFT_HOP) + 0.0018;
  return t - windowOffset * Math.floor(i / ANNOT_N_FRAMES);
}

export interface NoteEvent {
  startS: number;
  endS: number;
  pitch: number;
  amplitude: number;
}

export interface BpNoteOptions {
  onsetThresh?: number;
  frameThresh?: number;
  /** ms */
  minNoteMs?: number;
  minPitch?: number;
  maxPitch?: number;
  melodiaTrick?: boolean;
  energyTol?: number;
  /**
   * Seconds added to every onset. basic-pitch's onsets came out ~30-40 ms late both on our rendered
   * parts (median +35 ms, of which ~6 ms is the synth's own attack) and on a real recording
   * (~+40 ms vs a human-made chart), so the default moves them 25 ms earlier.
   */
  onsetShiftS?: number;
  /**
   * Merge a note into the same pitch just before it when it is not a real re-attack:
   * 'weak' = its onset is below the onset threshold; 'strict' = also when it is weaker than the
   * note's own onset and the level never dipped (sustained single-note lines: lead, voice).
   * Bass lines re-strike the same note legato, so they use 'weak'.
   */
  retrigger?: 'off' | 'weak' | 'strict';
}

/** basic-pitch's output_to_notes_polyphonic with infer_onsets = true. */
export function bpNotes(o: BpOutput, opts: BpNoteOptions = {}): NoteEvent[] {
  const onsetThresh = opts.onsetThresh ?? 0.5;
  const frameThresh = opts.frameThresh ?? 0.3;
  const minLen = Math.round(((opts.minNoteMs ?? 127.7) / 1000) * (BP_SR / FFT_HOP));
  const energyTol = opts.energyTol ?? 11;
  const n = o.frames;
  const P = N_PITCH;
  const frames = Float32Array.from(o.note);
  const onsets = Float32Array.from(o.onset);
  // Constrain the pitch range.
  const lo = opts.minPitch !== undefined ? Math.max(0, opts.minPitch - MIDI_OFFSET) : 0;
  const hi = opts.maxPitch !== undefined ? Math.min(P, opts.maxPitch - MIDI_OFFSET + 1) : P;
  for (let t = 0; t < n; t++) {
    for (let p = 0; p < P; p++) {
      if (p < lo || p >= hi) { frames[t * P + p] = 0; onsets[t * P + p] = 0; }
    }
  }
  // Inferred onsets: min over 1..2-frame differences of the frame activations.
  let maxOn = 0, maxDiff = 0;
  const diff = new Float32Array(n * P);
  for (let t = 0; t < n; t++) {
    for (let p = 0; p < P; p++) {
      const v = frames[t * P + p];
      const d1 = v - (t >= 1 ? frames[(t - 1) * P + p] : 0);
      const d2 = v - (t >= 2 ? frames[(t - 2) * P + p] : 0);
      let d = Math.min(d1, d2);
      if (d < 0 || t < 2) d = 0;
      diff[t * P + p] = d;
      if (d > maxDiff) maxDiff = d;
      if (onsets[t * P + p] > maxOn) maxOn = onsets[t * P + p];
    }
  }
  if (maxDiff > 0) for (let i = 0; i < diff.length; i++) onsets[i] = Math.max(onsets[i], (maxOn * diff[i]) / maxDiff);

  // Peaks along time (scipy argrelmax: strictly greater than both neighbours).
  const peaks: { t: number; p: number }[] = [];
  for (let t = 1; t < n - 1; t++) {
    for (let p = 0; p < P; p++) {
      const v = onsets[t * P + p];
      if (v >= onsetThresh && v > onsets[(t - 1) * P + p] && v > onsets[(t + 1) * P + p]) peaks.push({ t, p });
    }
  }
  // Backwards in time (numpy where order reversed: by time desc, then pitch desc).
  peaks.sort((a, b) => b.t - a.t || b.p - a.p);
  const energy = Float32Array.from(frames);
  const out: { s: number; e: number; p: number; a: number }[] = [];
  for (const { t: s, p } of peaks) {
    if (s >= n - 1) continue;
    let i = s + 1;
    let k = 0;
    while (i < n - 1 && k < energyTol) {
      if (energy[i * P + p] < frameThresh) k++;
      else k = 0;
      i++;
    }
    i -= k;
    if (i - s <= minLen) continue;
    for (let j = s; j < i; j++) {
      energy[j * P + p] = 0;
      if (p < P - 1) energy[j * P + p + 1] = 0;
      if (p > 0) energy[j * P + p - 1] = 0;
    }
    let a = 0;
    for (let j = s; j < i; j++) a += frames[j * P + p];
    out.push({ s, e: i, p, a: a / (i - s) });
  }
  if (opts.melodiaTrick ?? true) {
    for (;;) {
      let best = -1, bv = frameThresh;
      for (let i = 0; i < energy.length; i++) if (energy[i] > bv) { bv = energy[i]; best = i; }
      if (best < 0) break;
      const mid = Math.floor(best / P);
      const p = best % P;
      energy[best] = 0;
      const clear = (j: number) => {
        energy[j * P + p] = 0;
        if (p < P - 1) energy[j * P + p + 1] = 0;
        if (p > 0) energy[j * P + p - 1] = 0;
      };
      let i = mid + 1, k = 0;
      while (i < n - 1 && k < energyTol) {
        if (energy[i * P + p] < frameThresh) k++;
        else k = 0;
        clear(i);
        i++;
      }
      const end = i - 1 - k;
      i = mid - 1; k = 0;
      while (i > 0 && k < energyTol) {
        if (energy[i * P + p] < frameThresh) k++;
        else k = 0;
        clear(i);
        i--;
      }
      const start = i + 1 + k;
      if (end - start <= minLen) continue;
      let a = 0;
      for (let j = start; j < end; j++) a += frames[j * P + p];
      out.push({ s: start, e: end, p, a: a / Math.max(1, end - start) });
    }
  }
  // Re-triggers: a note that starts where the same pitch just ended, without a real onset peak in
  // the model's onset output, is the same note continuing (vibrato, distortion, bow noise).
  let notes = out.sort((a, b) => a.p - b.p || a.s - b.s);
  const rt = opts.retrigger ?? 'weak';
  if (rt !== 'off') {
    const merged: typeof out = [];
    for (const x of notes) {
      const prev = merged[merged.length - 1];
      if (prev && prev.p === x.p && x.s - prev.e <= 2) {
        const onAt = (f: number) => {
          let m = 0;
          for (let j = Math.max(0, f - 2); j <= Math.min(n - 1, f + 2); j++) m = Math.max(m, o.onset[j * P + x.p]);
          return m;
        };
        const on = onAt(x.s);
        // Did the note's level dip before the re-attack (a real repeated note releases first)?
        let dip = Infinity;
        for (let j = Math.max(prev.s + 1, x.s - 4); j <= Math.min(n - 1, x.s + 1); j++) dip = Math.min(dip, o.note[j * P + x.p]);
        if (on < onsetThresh || (rt === 'strict' && on < 0.85 * onAt(prev.s) && dip > 0.6 * prev.a)) {
          prev.a = (prev.a * (prev.e - prev.s) + x.a * (x.e - x.s)) / Math.max(1, x.e - prev.s);
          prev.e = Math.max(prev.e, x.e);
          continue;
        }
      }
      merged.push({ ...x });
    }
    notes = merged;
  }
  const shift = opts.onsetShiftS ?? -0.025;
  return notes
    .map((x) => ({ startS: Math.max(0, frameTime(x.s) + shift), endS: frameTime(x.e), pitch: x.p + MIDI_OFFSET, amplitude: x.a }))
    .sort((a, b) => a.startS - b.startS || a.pitch - b.pitch);
}
