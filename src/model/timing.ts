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

const TRIPLETS: { ticks: number; d: Duration }[] = ([2, 4, 8, 16, 32, 64] as DurationBase[]).map((base) => {
  const d: Duration = { base, dots: 0, tuplet: { num: 3, den: 2 } };
  return { ticks: durationTicks(d), d };
});

function greedy(ticks: number, list: { ticks: number; d: Duration }[]): Duration[] {
  const out: Duration[] = [];
  let left = ticks;
  while (left > 0) {
    const fit = list.find((s) => s.ticks <= left);
    if (!fit) break;
    out.push(structuredClone(fit.d));
    left -= fit.ticks;
  }
  return out;
}

/**
 * Split a tick length into notatable durations (greedy, largest first).
 * Lengths on the straight grid (multiples of a 64th, starting on it) use plain durations;
 * anything else (a triplet grid) uses triplet durations, split at quarter-note boundaries so
 * each piece stays inside one beat. `offset` = where the length starts within the bar.
 * Anything smaller than a 64th triplet is dropped.
 */
export function splitTicks(ticks: number, offset = 0): Duration[] {
  if (ticks <= 0) return [];
  if (ticks % 60 === 0 && offset % 60 === 0) return greedy(ticks, SIMPLE);
  const out: Duration[] = [];
  let pos = offset;
  let left = ticks;
  while (left > 0) {
    const toBeat = PPQ - (pos % PPQ);
    const piece = Math.min(left, toBeat);
    const parts = piece % 60 === 0 && pos % 60 === 0 ? greedy(piece, SIMPLE) : greedy(piece, TRIPLETS);
    out.push(...parts);
    pos += piece;
    left -= piece;
  }
  return out;
}
