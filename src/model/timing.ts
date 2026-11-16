import { PPQ, type BarHeader, type Duration, type DurationBase, type Song } from './types';

export function durationTicks(d: Duration): number {
  let t = (PPQ * 4) / d.base;
  let add = t / 2;
  for (let i = 0; i < d.dots; i++) {
    t += add;
    add /= 2;
  }
  if (d.tuplet) t = (t * d.tuplet.den) / d.tuplet.num;
  return Math.round(t);
}

export function barTicks(bar: BarHeader): number {
  return (PPQ * 4 * bar.timeSignature.numerator) / bar.timeSignature.denominator;
}

/** Absolute tick at which each bar starts (no repeats unrolled). */
export function barStartTicks(song: Song): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const b of song.bars) {
    starts.push(t);
    t += barTicks(b);
  }
  return starts;
}

const SIMPLE: { ticks: number; d: Duration }[] = (
  [
    [1, 1], [1, 0], [2, 1], [2, 0], [4, 1], [4, 0], [8, 1], [8, 0], [16, 1], [16, 0], [32, 0], [64, 0],
  ] as [DurationBase, 0 | 1][]
).map(([base, dots]) => ({ ticks: durationTicks({ base, dots }), d: { base, dots } }));

/**
 * Split a tick length into notatable durations (greedy, largest first).
 * Anything smaller than a 64th is dropped.
 */
export function splitTicks(ticks: number): Duration[] {
  const out: Duration[] = [];
  let left = ticks;
  while (left > 0) {
    const fit = SIMPLE.find((s) => s.ticks <= left);
    if (!fit) break;
    out.push({ ...fit.d });
    left -= fit.ticks;
  }
  return out;
}
