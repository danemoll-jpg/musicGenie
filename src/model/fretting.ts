// Find playable string/fret positions for pitches on a fretted instrument.

export const MAX_FRET = 24;

export interface Position {
  string: number; // 1-based, 1 = lowest string
  fret: number;
}

/** All positions where a single pitch can be played. */
export function positionsFor(pitch: number, tuning: number[], capo = 0, maxFret = MAX_FRET): Position[] {
  const out: Position[] = [];
  tuning.forEach((open, i) => {
    const fret = pitch - open;
    if (fret >= capo && fret <= maxFret) out.push({ string: i + 1, fret });
  });
  return out;
}

/**
 * Assign positions to a chord (all pitches sounding together), each on its own string.
 * Picks the assignment with the smallest fret span, then closest to `aroundFret`.
 * Returns null entries for pitches that cannot be placed.
 */
export function assignChord(
  pitches: number[],
  tuning: number[],
  opts: { capo?: number; maxFret?: number; aroundFret?: number } = {},
): (Position | null)[] {
  const capo = opts.capo ?? 0;
  const maxFret = opts.maxFret ?? MAX_FRET;
  const around = opts.aroundFret ?? 3;
  const options = pitches.map((p) => positionsFor(p, tuning, capo, maxFret));
  // Highest pitches first tends to keep melody notes on high strings.
  const order = pitches.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);

  let best: (Position | null)[] | null = null;
  let bestScore = Infinity;
  const current: (Position | null)[] = pitches.map(() => null);
  const used = new Set<number>();
  let placedBest = -1;
  let steps = 0;

  const score = (assign: (Position | null)[]): number => {
    const frets = assign.filter((p): p is Position => !!p && p.fret > 0).map((p) => p.fret);
    if (!frets.length) return 0;
    const span = Math.max(...frets) - Math.min(...frets);
    const avg = frets.reduce((a, b) => a + b, 0) / frets.length;
    return (span > 4 ? 100 * span : span * 4) + Math.abs(avg - around);
  };

  const recurse = (k: number, placed: number) => {
    if (++steps > 20000) return;
    if (k === order.length) {
      const s = score(current);
      if (placed > placedBest || (placed === placedBest && s < bestScore)) {
        placedBest = placed;
        bestScore = s;
        best = current.slice();
      }
      return;
    }
    const idx = order[k];
    let any = false;
    for (const pos of options[idx]) {
      if (used.has(pos.string)) continue;
      any = true;
      used.add(pos.string);
      current[idx] = pos;
      recurse(k + 1, placed + 1);
      used.delete(pos.string);
      current[idx] = null;
    }
    if (!any || placed + (order.length - k - 1) >= placedBest) recurse(k + 1, placed);
  };
  recurse(0, 0);
  return best ?? pitches.map(() => null);
}
