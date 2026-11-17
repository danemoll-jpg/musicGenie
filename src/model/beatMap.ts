// Beats from a recording -> bars and a tempo map, and the beat-marker edits (Round 6). Pure.
//
// A "grid" is the list of every beat's time (song ms) plus which beats start a bar. Songs are
// rebuilt from a grid: the tempo map is fitted to the beat times (piecewise-constant tempo,
// a new tempo point only where the beats drift more than `tolMs` from the current tempo).
// Audio clips never move: they are re-anchored so they keep their time. Notes either keep their
// bar/tick (tempo-only edits) or keep their time (when bars are rebuilt).
import { cloneSong } from './edits';
import { buildMeasures, trackEvents, type NoteEvent } from './events';
import { layoutVoices } from './pianoRoll';
import { restMeasure } from './noteEdit';
import { msAtTick, tempoPoints, tickAtMs } from './tempo';
import { barStartTicks, barTicks } from './timing';
import { PPQ, type BarHeader, type Song, type TempoChange } from './types';
import { clipStartMs, msToPos } from './audioClips';

export interface Grid {
  /** Every beat (song ms), ascending. */
  beats: number[];
  /** Index into `beats` of each bar's first beat (ascending, first = 0). */
  barStarts: number[];
  /** Beat unit (time-signature denominator) per bar; default 4. */
  denominators?: number[];
}

/** Beats per bar as a numerator list. */
export function gridNumerators(g: Grid): number[] {
  return g.barStarts.map((s, i) => (i + 1 < g.barStarts.length ? g.barStarts[i + 1] : g.beats.length) - s);
}

/**
 * Detected beats/downbeats (seconds in the recording) -> a grid in RECORDING ms.
 * Bars come from the downbeats (each bar = beats up to the next downbeat; >7 splits into the
 * usual bar length); bars are added in front (extrapolated) so the song starts at or before the
 * recording, and the last bar is filled up with extrapolated beats.
 */
export function gridFromDetection(beatsS: number[], downbeatsS: number[], opts: { numerator?: number } = {}): Grid & { numerator: number } {
  const beats = [...beatsS].sort((a, b) => a - b).map((s) => s * 1000);
  if (beats.length < 4) throw new Error('Too few beats were found in this recording.');
  const near = (t: number) => {
    let best = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
    return best;
  };
  let downIdx = [...new Set(downbeatsS.map((s) => near(s * 1000)))].sort((a, b) => a - b);
  // Mode of the bar lengths.
  const counts = new Map<number, number>();
  for (let i = 1; i < downIdx.length; i++) {
    const c = downIdx[i] - downIdx[i - 1];
    if (c >= 2 && c <= 7) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let N = opts.numerator ?? 4;
  if (!opts.numerator && counts.size) N = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  if (opts.numerator || !downIdx.length) {
    // Forced (or no downbeats): every N beats from the first downbeat (or the first beat).
    const first = downIdx[0] ?? 0;
    downIdx = [];
    for (let i = first % N; i < beats.length; i += N) downIdx.push(i);
  }
  // Bar starts: split long gaps into N-beat bars.
  const starts: number[] = [];
  for (let i = 0; i < downIdx.length; i++) {
    const a = downIdx[i];
    const b = i + 1 < downIdx.length ? downIdx[i + 1] : beats.length;
    starts.push(a);
    if (b - a > 7) for (let k = a + N; k < b - 1; k += N) starts.push(k);
  }
  // Pickup beats before the first downbeat: extrapolated beats in front make it whole bars.
  const interval0 = beats[1] - beats[0];
  const pre = starts[0];
  const need = (N - (pre % N)) % N;
  let all = [...Array.from({ length: need }, (_, k) => beats[0] - (need - k) * interval0), ...beats];
  let barStarts: number[] = [];
  for (let k = 0; k < pre + need; k += N) barStarts.push(k);
  barStarts.push(...starts.map((x) => x + need));
  barStarts = [...new Set(barStarts)].sort((x, y) => x - y);
  // Whole bars in front until the song starts at (or within 100 ms after) the recording's start;
  // a clip that starts a little before bar 1 just loses that bit of silence.
  while (all[0] > 100) {
    all = [...Array.from({ length: N }, (_, k) => all[0] - (N - k) * interval0), ...all];
    barStarts = [0, ...barStarts.map((x) => x + N)];
  }
  // Fill the last bar.
  const last = barStarts[barStarts.length - 1];
  const iv = all[all.length - 1] - all[all.length - 2];
  while (all.length - last < N) all.push(all[all.length - 1] + iv);
  return { beats: all, barStarts, numerator: N };
}

/** Piecewise-constant tempo fitted to beat times (ms). Returns one bpm per segment start beat. */
export function fitTempos(beats: number[], tolMs = 8): { beat: number; bpm: number }[] {
  const out: { beat: number; bpm: number }[] = [];
  let s = 0;
  let t0 = beats[0];
  while (s < beats.length - 1) {
    // Extend [s, e] while the anchored least-squares slope predicts every beat within tol.
    let e = s + 1;
    let slope = beats[s + 1] - t0;
    for (let k = s + 2; k < beats.length; k++) {
      let num = 0, den = 0;
      for (let i = s + 1; i <= k; i++) { num += (i - s) * (beats[i] - t0); den += (i - s) * (i - s); }
      const sl = num / den;
      let ok = true;
      for (let i = s + 1; i <= k && ok; i++) if (Math.abs(t0 + sl * (i - s) - beats[i]) > tolMs) ok = false;
      if (!ok) break;
      e = k;
      slope = sl;
    }
    if (e === s + 1) slope = beats[s + 1] - t0;
    out.push({ beat: s, bpm: 60000 / slope });
    t0 = t0 + slope * (e - s);
    s = e;
  }
  if (!out.length) out.push({ beat: 0, bpm: 120 });
  return out;
}

/** The song's beat grid in song ms (beats = time-signature denominators). */
export function gridFromSong(song: Song): Grid {
  const pts = tempoPoints(song);
  const starts = barStartTicks(song);
  const beats: number[] = [];
  const barStarts: number[] = [];
  const denominators: number[] = [];
  song.bars.forEach((b, i) => {
    barStarts.push(beats.length);
    denominators.push(b.timeSignature.denominator);
    const step = (PPQ * 4) / b.timeSignature.denominator;
    for (let k = 0; k < b.timeSignature.numerator; k++) beats.push(msAtTick(pts, starts[i] + k * step));
  });
  return { beats, barStarts, denominators };
}

export interface RebuildOptions {
  /** Notes keep their time (bars rebuilt) instead of their bar/tick (tempo-only edit). */
  keepTime: boolean;
  tolMs?: number;
}

/**
 * Rebuild a song on a grid given in OLD song ms. The grid's first beat becomes
 * song time 0. Clips keep their time; notes keep bar/tick unless keepTime.
 */
export function applyGrid(song: Song, grid: Grid, opts: RebuildOptions): Song {
  const shift = -grid.beats[0];
  const beatsNew = grid.beats.map((b) => b + shift);
  const nums = gridNumerators(grid);
  const dens = grid.denominators ?? nums.map(() => 4);
  const oldKey = song.bars[0]?.key ?? { fifths: 0, mode: 'major' as const };
  const bars: BarHeader[] = nums.map((n, i) => {
    // Keep each bar's key from the old bar at the same position when the bar count is unchanged.
    const old = !opts.keepTime ? song.bars[i] : undefined;
    return { timeSignature: { numerator: Math.max(1, n), denominator: dens[i] ?? 4 }, key: old ? { ...old.key } : { ...oldKey } };
  });
  // Tempo map (tempo = quarter notes per minute; a beat of /8 is half a quarter).
  const fit = fitTempos(beatsNew, opts.tolMs ?? 8);
  const barOfBeat: { bar: number; k: number }[] = [];
  nums.forEach((n, i) => { for (let k = 0; k < n; k++) barOfBeat.push({ bar: i, k }); });
  const tempos: TempoChange[] = fit.map((f) => {
    const { bar, k } = barOfBeat[f.beat] ?? { bar: 0, k: 0 };
    const den = dens[bar] ?? 4;
    return { bar, tick: (k * PPQ * 4) / den, bpm: +((f.bpm * 4) / den).toFixed(3) };
  });
  const old = song;
  const oldPts = tempoPoints(old);
  const oldStarts = barStartTicks(old);
  const next: Song = cloneSong(song);
  next.bars = bars;
  next.tempos = tempos;
  const newPts = tempoPoints(next);
  const newStarts = barStartTicks(next);
  const total = newStarts[newStarts.length - 1] + barTicks(bars[bars.length - 1]);
  const toNewTick = (oldTick: number) => tickAtMs(newPts, msAtTick(oldPts, oldTick) + shift);
  const q = (t: number) => Math.round(t / 30) * 30; // 1/128 grid: keeps notation sane, < 8 ms

  for (let ti = 0; ti < next.tracks.length; ti++) {
    const t = next.tracks[ti];
    const ot = old.tracks[ti];
    if (opts.keepTime || bars.length !== old.bars.length) {
      const evs = trackEvents(old, ot);
      t.staves = t.staves.map((st, si) => {
        const mine: NoteEvent[] = evs.filter((e) => e.staff === si).map((e) => {
          const s = q(toNewTick(e.start));
          const en = q(toNewTick(e.start + e.dur));
          return { ...e, start: s, dur: Math.max(30, en - s) };
        }).filter((e) => e.start >= 0 && e.start < total);
        if (!mine.length) return { ...st, measures: bars.map((b) => restMeasure(b)) };
        const voices = layoutVoices(mine, t.instrument.percussion);
        const built = voices.map((v) => buildMeasures(next, v, { percussion: t.instrument.percussion, tuning: t.tuning, capo: t.capo ?? 0 }));
        return {
          ...st,
          measures: bars.map((_, b) => {
            const vs = built.map((m) => m[b].voices[0]);
            let lastV = 0;
            vs.forEach((v, vi) => { if (v.beats.some((x) => x.notes.length)) lastV = vi; });
            return { voices: vs.slice(0, lastV + 1) };
          }),
        };
      });
    }
    if (t.audio) {
      t.audio = {
        ...t.audio,
        clips: t.audio.clips.map((c) => {
          const ms = clipStartMs(old, c) + shift;
          const pos = msToPos(next, Math.max(0, ms));
          // A clip that would start before bar 1 is trimmed at its front so its audio keeps its time.
          const cut = ms < 0 ? -ms : 0;
          return { ...c, ...pos, startMs: c.startMs + cut, lengthMs: Math.max(10, c.lengthMs - cut) };
        }),
      };
    }
    if (t.automation && (opts.keepTime || bars.length !== old.bars.length)) {
      t.automation = t.automation.map((l) => ({
        ...l,
        points: l.points.map((p) => {
          const pos = msToPos(next, Math.max(0, msAtTick(oldPts, (oldStarts[p.bar] ?? 0) + p.tick) + shift));
          return { ...p, bar: pos.bar, tick: pos.tick };
        }),
      }));
    }
  }
  if (opts.keepTime || bars.length !== old.bars.length) {
    const conv = (bar: number, tick: number) => msToPos(next, Math.max(0, msAtTick(oldPts, (oldStarts[bar] ?? 0) + tick) + shift), 240);
    next.chordSymbols = old.chordSymbols.map((c) => ({ ...c, ...conv(c.bar, c.tick) }));
    next.sections = old.sections.map((s) => ({ ...s, bar: conv(s.bar, 0).bar })).filter((s, i, a) => i === 0 || s.bar !== a[i - 1].bar);
  }
  if (next.backing) next.backing = { ...next.backing, offsetMs: next.backing.offsetMs - shift };
  return next;
}

// ------------------------------------------------------------------ edits

/** Global beat index of (bar, beat). */
export function beatIndex(g: Grid, bar: number, beat: number): number {
  return (g.barStarts[bar] ?? 0) + beat;
}

/**
 * Move one beat to `ms` (song time). Beats between the bar lines around it are spread evenly,
 * bars and notes keep their places in the music, the audio stays where it is.
 */
export function moveBeat(song: Song, bar: number, beat: number, ms: number): Song {
  const g = gridFromSong(song);
  const k = beatIndex(g, bar, beat);
  const prevBar = beat === 0 ? Math.max(0, bar - 1) : bar;
  const a = beat === 0 && bar === 0 ? 0 : g.barStarts[prevBar];
  const b = Math.min(g.beats.length - 1, (g.barStarts[bar + 1] ?? g.beats.length - 1));
  const lo = k > 0 ? g.beats[k - 1] + 20 : -Infinity;
  const hi = k + 1 < g.beats.length ? g.beats[k + 1] - 20 : Infinity;
  const target = Math.max(lo, Math.min(hi, ms));
  const beats = g.beats.slice();
  const spread = (from: number, to: number) => {
    for (let i = from + 1; i < to; i++) beats[i] = beats[from] + ((beats[to] - beats[from]) * (i - from)) / (to - from);
  };
  beats[k] = target;
  if (k === 0) {
    // Moving the very first beat moves the song start: the whole song shifts.
    for (let i = 1; i < beats.length; i++) beats[i] = g.beats[i] + (target - g.beats[0]);
  } else {
    spread(a, k);
    if (b > k) spread(k, b);
    else for (let i = k + 1; i < beats.length; i++) beats[i] = g.beats[i] + (target - g.beats[k]);
  }
  return applyGrid(song, { ...g, beats }, { keepTime: false, tolMs: 2 });
}

/**
 * Tap tempo over bars [fromBar, toBar): the taps (song ms) give the beat length and phase; the
 * section's beats are placed on that grid, starting at the tap grid point nearest the section's
 * first beat. Beats after the section keep their times.
 */
export function tapTempo(song: Song, fromBar: number, toBar: number, taps: number[]): Song {
  if (taps.length < 3) throw new Error('Tap at least 4 times.');
  const d = taps.slice(1).map((t, i) => t - taps[i]).sort((x, y) => x - y);
  const iv = d[Math.floor(d.length / 2)];
  let phase = 0;
  taps.forEach((t, i) => { phase += t - iv * Math.round((t - taps[0]) / iv); });
  phase /= taps.length;
  const g = gridFromSong(song);
  const a = g.barStarts[fromBar];
  const b = toBar < g.barStarts.length ? g.barStarts[toBar] : g.beats.length;
  const beats = g.beats.slice();
  const start = phase + iv * Math.round((g.beats[a] - phase) / iv);
  for (let i = a; i < b; i++) beats[i] = start + (i - a) * iv;
  // Keep order after the section.
  for (let i = b; i < beats.length; i++) if (beats[i] <= beats[i - 1] + 20) beats[i] = beats[i - 1] + 20;
  return applyGrid(song, { ...g, beats }, { keepTime: false, tolMs: 2 });
}

/** Make (bar, beat) a downbeat: that bar is cut short there, later bars follow on. Notes keep their time. */
export function setDownbeat(song: Song, bar: number, beat: number): Song {
  if (beat === 0) return song;
  const g = gridFromSong(song);
  const N = song.bars[bar].timeSignature.numerator;
  const k = beatIndex(g, bar, beat);
  const starts = g.barStarts.filter((s) => s <= g.barStarts[bar]);
  for (let s = k; s < g.beats.length; s += N) starts.push(s);
  // Fill the end so the last bar is whole.
  const beats = g.beats.slice();
  const last = starts[starts.length - 1];
  const iv = beats[beats.length - 1] - beats[beats.length - 2];
  while (beats.length - last < N) beats.push(beats[beats.length - 1] + iv);
  return applyGrid(song, { beats, barStarts: starts }, { keepTime: true, tolMs: 2 });
}

/** Re-bar from `bar` on with `numerator` beats per bar (beats keep their times; notes too). */
export function rebar(song: Song, bar: number, numerator: number, untilBar?: number): Song {
  const g = gridFromSong(song);
  const from = g.barStarts[bar];
  const until = untilBar !== undefined && untilBar < g.barStarts.length ? g.barStarts[untilBar] : g.beats.length;
  const starts = g.barStarts.filter((s) => s < from);
  for (let s = from; s < until; s += numerator) starts.push(s);
  for (const s of g.barStarts) if (s >= until) starts.push(s);
  const beats = g.beats.slice();
  const iv = beats[beats.length - 1] - beats[beats.length - 2];
  const lastStart = starts[starts.length - 1];
  const want = untilBar !== undefined && untilBar < g.barStarts.length ? song.bars[song.bars.length - 1].timeSignature.numerator : numerator;
  while (beats.length - lastStart < want) beats.push(beats[beats.length - 1] + iv);
  return applyGrid(song, { beats, barStarts: [...new Set(starts)].sort((x, y) => x - y) }, { keepTime: true, tolMs: 2 });
}

/** Beat times of the song in RECORDING seconds, for a clip that holds the recording. */
export function beatsInRecording(song: Song, clip: { startMs: number; bar: number; tick: number }): { t: number; bar: number; beat: number }[] {
  const g = gridFromSong(song);
  const c0 = msAtTick(tempoPoints(song), (barStartTicks(song)[clip.bar] ?? 0) + clip.tick);
  const out: { t: number; bar: number; beat: number }[] = [];
  gridNumerators(g).forEach((n, bar) => {
    for (let k = 0; k < n; k++) out.push({ t: (g.beats[g.barStarts[bar] + k] - c0 + clip.startMs) / 1000, bar, beat: k });
  });
  return out;
}

/**
 * A song for a recording: bars and tempo map from detected beats; the recording sits on an
 * audio track at its own time. `beatsS`/`downbeatsS` are seconds in the recording.
 */
export function songGridFromBeats(song: Song, clip: { bar: number; tick: number; startMs: number }, beatsS: number[], downbeatsS: number[], numerator?: number): Song {
  const g = gridFromDetection(beatsS, downbeatsS, { numerator });
  // Recording ms -> old song ms: song = clipSongMs + (rec - startMs).
  const c0 = msAtTick(tempoPoints(song), (barStartTicks(song)[clip.bar] ?? 0) + clip.tick);
  const beats = g.beats.map((r) => c0 + r - clip.startMs);
  // 12 ms: detected beats jitter by a few ms; a new tempo point only where the music really moves.
  return applyGrid(song, { beats, barStarts: g.barStarts }, { keepTime: true, tolMs: 12 });
}
