// Beat This! (CPJKU, MIT) host code: split the log-mel features into 1500-frame chunks with
// 6-frame borders (split_piece / aggregate_prediction, keep_first), then the "minimal"
// post-processor (peak picking with a 7-frame max filter, logits > 0, duplicates merged,
// downbeats snapped to the nearest beat). Pure: the model call is passed in.

export const BEAT_FPS = 50;
const CHUNK = 1500;
const BORDER = 6;
const MELS = 128;

/** One chunk [1, T, 128] -> beat / downbeat logits [T]. */
export type BeatRun = (spect: Float32Array, frames: number) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

export async function beatLogits(feat: Float32Array, frames: number, run: BeatRun, progress?: (d: number, t: number) => void): Promise<{ beat: Float32Array; downbeat: Float32Array }> {
  const starts: number[] = [];
  for (let s = -BORDER; s < frames - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (frames > CHUNK - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  const beat = new Float32Array(frames).fill(-1000);
  const down = new Float32Array(frames).fill(-1000);
  const preds: { start: number; beat: Float32Array; downbeat: Float32Array }[] = [];
  for (let c = 0; c < starts.length; c++) {
    const start = starts[c];
    const from = Math.max(start, 0);
    const to = Math.min(start + CHUNK, frames);
    const left = Math.max(0, -start);
    const right = Math.max(0, Math.min(BORDER, start + CHUNK - frames));
    const len = left + (to - from) + right;
    const x = new Float32Array(len * MELS);
    x.set(feat.subarray(from * MELS, to * MELS), left * MELS);
    const r = await run(x, len);
    preds.push({ start, beat: r.beat, downbeat: r.downbeat });
    progress?.(c + 1, starts.length);
  }
  // keep_first: write the chunks in reverse so the earlier chunk wins on overlaps.
  for (let c = preds.length - 1; c >= 0; c--) {
    const p = preds[c];
    const n = p.beat.length - 2 * BORDER;
    for (let i = 0; i < n; i++) {
      const at = p.start + BORDER + i;
      if (at < 0 || at >= frames) continue;
      beat[at] = p.beat[BORDER + i];
      down[at] = p.downbeat[BORDER + i];
    }
  }
  return { beat, downbeat: down };
}

function peaks(x: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] <= 0) continue;
    let mx = -Infinity;
    for (let j = Math.max(0, i - 3); j <= Math.min(x.length - 1, i + 3); j++) mx = Math.max(mx, x[j]);
    if (x[i] === mx) out.push(i);
  }
  // Merge adjacent peak frames (running mean, width 1).
  const res: number[] = [];
  if (!out.length) return res;
  let p = out[0];
  let c = 1;
  for (let k = 1; k < out.length; k++) {
    const p2 = out[k];
    if (p2 - p <= 1) {
      c++;
      p += (p2 - p) / c;
    } else {
      res.push(p);
      p = p2;
      c = 1;
    }
  }
  res.push(p);
  // Sub-frame position: parabola through the logits around each (integer) peak.
  return res.map((f) => {
    const i = Math.round(f);
    if (i !== f || i <= 0 || i >= x.length - 1) return f;
    const a = x[i - 1], b = x[i], c = x[i + 1];
    const den = a - 2 * b + c;
    if (den >= 0) return f;
    return i + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  });
}

/** Beat and downbeat times (seconds) from logits. Downbeats are a subset of beats. */
export function pickBeats(beat: Float32Array, downbeat: Float32Array): { beats: number[]; downbeats: number[] } {
  const beats = peaks(beat).map((f) => f / BEAT_FPS);
  const dRaw = peaks(downbeat).map((f) => f / BEAT_FPS);
  const ds = new Set<number>();
  if (beats.length) {
    for (const d of dRaw) {
      let best = 0;
      for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - d) < Math.abs(beats[best] - d)) best = i;
      ds.add(beats[best]);
    }
  }
  return { beats, downbeats: [...ds].sort((a, b) => a - b) };
}
