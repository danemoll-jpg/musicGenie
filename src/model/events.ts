// Notes as absolute-time events, and the reverse: events -> notated measures.
import { assignChord } from './fretting';
import { barStartTicks, barTicks, durationTicks, splitTicks } from './timing';
import type { Beat, Measure, Note, Song, Track } from './types';

export interface NoteEvent {
  /** Absolute start tick (PPQ 960, repeats not unrolled). */
  start: number;
  /** Length in ticks (tied continuations merged in). */
  dur: number;
  pitch: number;
  velocity: number;
  string?: number;
  fret?: number;
  techniques?: Note['techniques'];
  staff: number;
  voice: number;
}

/**
 * Every sounded note of a track as an event. Tied continuations extend the note they continue.
 * Grace notes are skipped (they take no time).
 */
export function trackEvents(song: Song, track: Track): NoteEvent[] {
  const starts = barStartTicks(song);
  const out: NoteEvent[] = [];
  track.staves.forEach((staff, si) => {
    const open = new Map<string, NoteEvent>(); // voice:pitch -> last event
    staff.measures.forEach((m, bi) => {
      m.voices.forEach((v, vi) => {
        let t = starts[bi] ?? 0;
        for (const b of v.beats) {
          if (b.grace) continue;
          const d = durationTicks(b.duration);
          for (const n of b.notes) {
            const key = `${vi}:${n.pitch}`;
            const prev = open.get(key);
            if (n.tieFromPrevious && prev && prev.start + prev.dur === t) {
              prev.dur += d;
              continue;
            }
            const e: NoteEvent = { start: t, dur: d, pitch: n.pitch, velocity: n.velocity, staff: si, voice: vi };
            if (n.string !== undefined) e.string = n.string;
            if (n.fret !== undefined) e.fret = n.fret;
            if (n.techniques) e.techniques = n.techniques;
            out.push(e);
            open.set(key, e);
          }
          t += d;
        }
      });
    });
  });
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return out;
}

export interface BuildOptions {
  percussion?: boolean;
  /** Fretted instrument tuning: notes get string/fret positions. */
  tuning?: number[];
  /** Only build bars in [fromBar, toBar). Default: all. */
  fromBar?: number;
  toBar?: number;
}

/**
 * Lay events out as single-voice measures. Notes starting together form a chord; a chord lasts
 * until its longest note ends or the next chord starts. Gaps become rests. Notes crossing a
 * beat-awkward length or a barline are split and tied (drums are not tied: the rest is silence).
 */
export function buildMeasures(song: Song, events: NoteEvent[], opts: BuildOptions = {}): Measure[] {
  const starts = barStartTicks(song);
  const from = opts.fromBar ?? 0;
  const to = opts.toBar ?? song.bars.length;
  // Group by start.
  const sorted = [...events].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: { start: number; end: number; ev: NoteEvent[] }[] = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.start === e.start) {
      if (!g.ev.some((x) => x.pitch === e.pitch)) g.ev.push(e);
      g.end = Math.max(g.end, e.start + e.dur);
    } else groups.push({ start: e.start, end: e.start + e.dur, ev: [e] });
  }
  for (let i = 0; i < groups.length - 1; i++) groups[i].end = Math.min(groups[i].end, groups[i + 1].start);

  // Fret positions per chord, kept near the previous chord's position.
  const positions = new Map<NoteEvent, { string: number; fret: number }>();
  if (opts.tuning && !opts.percussion) {
    let around = 5;
    for (const g of groups) {
      const pre = g.ev.filter((e) => e.string !== undefined && e.fret !== undefined);
      if (pre.length === g.ev.length) {
        for (const e of g.ev) positions.set(e, { string: e.string!, fret: e.fret! });
        continue;
      }
      const pos = assignChord(g.ev.map((e) => e.pitch), opts.tuning, { aroundFret: around });
      const frets: number[] = [];
      g.ev.forEach((e, i) => {
        if (pos[i]) {
          positions.set(e, pos[i]!);
          if (pos[i]!.fret > 0) frets.push(pos[i]!.fret);
        }
      });
      if (frets.length) around = frets.reduce((a, b) => a + b, 0) / frets.length;
    }
  }

  const measures: Measure[] = [];
  let gi = 0;
  for (let bi = from; bi < to; bi++) {
    const bs = starts[bi];
    const be = bs + barTicks(song.bars[bi]);
    const beats: Beat[] = [];
    const rest = (len: number) => {
      for (const d of splitTicks(len)) beats.push({ duration: d, notes: [] });
    };
    let cur = bs;
    while (gi < groups.length && groups[gi].end <= bs) gi++;
    let k = gi;
    while (k < groups.length && groups[k].start < be) {
      const g = groups[k];
      const s = Math.max(g.start, bs);
      const e = Math.min(g.end, be);
      if (s > cur) rest(s - cur);
      if (e > s) {
        const pieces = splitTicks(e - s);
        const continued = g.start < bs; // started in an earlier bar
        pieces.forEach((d, pi) => {
          const tie = continued || pi > 0;
          if (tie && opts.percussion) {
            beats.push({ duration: d, notes: [] });
            return;
          }
          beats.push({
            duration: d,
            notes: g.ev.map((ev) => {
              const n: Note = { pitch: ev.pitch, velocity: ev.velocity };
              const p = positions.get(ev);
              if (p) {
                n.string = p.string;
                n.fret = p.fret;
              }
              if (tie) n.tieFromPrevious = true;
              else if (ev.techniques) n.techniques = structuredClone(ev.techniques);
              return n;
            }),
          });
        });
        cur = e;
      }
      if (g.end > be) break; // continues into the next bar
      k++;
    }
    if (cur < be) rest(be - cur);
    measures.push({ voices: [{ beats }] });
  }
  return measures;
}

/** Stable short hash (FNV-1a, 32 bit, hex) of any JSON-able value. */
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
