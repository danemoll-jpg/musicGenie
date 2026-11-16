// Ticks <-> milliseconds through the tempo map (no repeats unrolled, same as playback of the model).
import { barStartTicks, barTicks } from './timing';
import { PPQ, type Song } from './types';

export interface TempoPoint {
  /** Absolute tick. */
  tick: number;
  bpm: number;
  /** Time at this tick (ms from bar 1). */
  ms: number;
}

export function tempoPoints(song: Song): TempoPoint[] {
  const starts = barStartTicks(song);
  const raw = song.tempos
    .map((t) => ({ tick: (starts[t.bar] ?? 0) + t.tick, bpm: t.bpm }))
    .sort((a, b) => a.tick - b.tick);
  const pts: TempoPoint[] = [];
  for (const r of raw) {
    if (pts.length && pts[pts.length - 1].tick === r.tick) {
      pts[pts.length - 1].bpm = r.bpm;
      continue;
    }
    pts.push({ tick: r.tick, bpm: r.bpm, ms: 0 });
  }
  if (!pts.length || pts[0].tick > 0) pts.unshift({ tick: 0, bpm: pts[0]?.bpm ?? 120, ms: 0 });
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    pts[i].ms = p.ms + ((pts[i].tick - p.tick) * 60000) / (PPQ * p.bpm);
  }
  return pts;
}

function segmentAt<T>(arr: T[], key: (x: T) => number, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (key(arr[mid]) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function msAtTick(pts: TempoPoint[], tick: number): number {
  const p = pts[segmentAt(pts, (x) => x.tick, tick)];
  return p.ms + ((tick - p.tick) * 60000) / (PPQ * p.bpm);
}

export function tickAtMs(pts: TempoPoint[], ms: number): number {
  const p = pts[segmentAt(pts, (x) => x.ms, ms)];
  return p.tick + ((ms - p.ms) * PPQ * p.bpm) / 60000;
}

export function songEndTick(song: Song): number {
  return song.bars.reduce((a, b) => a + barTicks(b), 0);
}

/** Length of the song (end of the last bar) in ms. */
export function songLengthMs(song: Song): number {
  return msAtTick(tempoPoints(song), songEndTick(song));
}
