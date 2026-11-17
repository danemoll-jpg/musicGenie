// Pitch estimate of a steady tone (YIN difference function + parabolic refinement). Pure.
// Used to prove that slowed-down playback keeps its pitch.
export function estimatePitch(x: ArrayLike<number>, sampleRate: number, fMin = 50, fMax = 2000): number {
  const n = x.length;
  const maxLag = Math.min(Math.floor(sampleRate / fMin), Math.floor(n / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / fMax));
  const W = n - maxLag;
  if (W < 64) return 0;
  const d = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  const c = new Float64Array(maxLag + 1);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    run += d[tau];
    c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let best = -1;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (c[tau] < 0.15) {
      while (tau + 1 < maxLag && c[tau + 1] < c[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let mv = Infinity;
    for (let tau = minLag; tau < maxLag; tau++) if (c[tau] < mv) { mv = c[tau]; best = tau; }
  }
  const a = c[best - 1], b = c[best], e = c[best + 1] ?? b;
  const den = a - 2 * b + e;
  const shift = den !== 0 ? (0.5 * (a - e)) / den : 0;
  return sampleRate / (best + Math.max(-1, Math.min(1, shift)));
}
