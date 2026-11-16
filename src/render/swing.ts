// Swing feel at playback: off-beat 8ths are delayed, notation stays straight.

/**
 * Map a straight tick to its swung tick. amount 0 = straight, 1 = triplet feel (the off-beat
 * 8th lands 2/3 of the way through the beat). Beats themselves never move.
 */
export function swingTick(tick: number, amount: number, ppq = 960): number {
  if (!amount) return tick;
  const half = ppq / 2;
  const d = Math.max(0, Math.min(1, amount)) * (ppq / 6); // 1 -> off-beat at 2/3 of the beat
  const q = Math.floor(tick / ppq) * ppq;
  const r = tick - q;
  const out = r <= half ? (r * (half + d)) / half : half + d + ((r - half) * (half - d)) / half;
  return q + Math.round(out);
}

interface TickEvent { tick: number }
interface MidiLike { tracks: { events: TickEvent[] }[]; tickShift?: number }

/** Apply swing to every event of an alphaTab MidiFile in place (event order is preserved). */
export function applySwing(file: MidiLike, amount: number, ppq = 960) {
  if (!amount) return;
  const shift = file.tickShift ?? 0;
  for (const t of file.tracks) for (const e of t.events) e.tick = swingTick(e.tick - shift, amount, ppq) + shift;
}
