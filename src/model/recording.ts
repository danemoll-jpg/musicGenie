// MIDI keyboard input, pure parts: turn timed MIDI messages into notes (live recording with
// quantise), merge a take into a track, and step entry (a chord at the cursor beat).
import { assignChord } from './fretting';
import { editStaffNotes, type RollNote } from './pianoRoll';
import { DEFAULT_VELOCITY, editVoice, isFretted, type Cursor } from './noteEdit';
import { PPQ, type Note, type Song } from './types';

export type Quantize = 'none' | '8' | '16' | '8T' | '16T';

export const QUANTIZE: { id: Quantize; label: string; ticks: number }[] = [
  { id: 'none', label: 'none', ticks: PPQ / 16 }, // still on a 64th grid so it can be written down
  { id: '8', label: '1/8', ticks: PPQ / 2 },
  { id: '16', label: '1/16', ticks: PPQ / 4 },
  { id: '8T', label: '1/8 triplet', ticks: PPQ / 3 },
  { id: '16T', label: '1/16 triplet', ticks: PPQ / 6 },
];

export interface MidiMessage {
  /** Time in ms (performance.now() or MIDIMessageEvent.timeStamp). */
  time: number;
  data: number[];
}

/** One recorded note before quantising: ticks may be fractional. */
export interface RawNote {
  start: number;
  end: number;
  pitch: number;
  velocity: number;
}

/**
 * Collects note on/off messages into notes. `clock` turns a message time into a song tick
 * (in the app: the player's position + the time since it was reported, through the tempo map).
 */
export class MidiRecorder {
  private open = new Map<number, { start: number; velocity: number }>();
  readonly notes: RawNote[] = [];
  constructor(private clock: (timeMs: number) => number) {}

  message(m: MidiMessage) {
    const [status, d1, d2 = 0] = m.data;
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) {
      this.close(d1, m.time);
      this.open.set(d1, { start: this.clock(m.time), velocity: d2 });
    } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
      this.close(d1, m.time);
    }
  }

  private close(pitch: number, time: number) {
    const o = this.open.get(pitch);
    if (!o) return;
    this.open.delete(pitch);
    this.notes.push({ start: o.start, end: this.clock(time), pitch, velocity: o.velocity });
  }

  /** Close held notes at `time` and return everything recorded. */
  finish(time: number): RawNote[] {
    for (const p of [...this.open.keys()]) this.close(p, time);
    return this.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
}

/** A clock for a fixed tempo: tick at `time` when tick `startTick` was at `startTime` (speed 1 = 100%). */
export function fixedTempoClock(bpm: number, startTick: number, startTime: number, speed = 1): (t: number) => number {
  return (t) => startTick + ((t - startTime) * PPQ * bpm * speed) / 60000;
}

/** Snap starts (and lengths, at least one grid step) to the grid; drop notes before `from`. */
export function quantizeNotes(raw: RawNote[], q: Quantize, from = 0, to = Infinity): RollNote[] {
  const g = QUANTIZE.find((x) => x.id === q)?.ticks ?? PPQ / 4;
  const out: RollNote[] = [];
  for (const n of raw) {
    let start = Math.round(n.start / g) * g;
    let end = Math.round(n.end / g) * g;
    if (end <= start) end = start + g;
    if (end <= from || start >= to) continue;
    start = Math.max(from, start);
    end = Math.min(to, end);
    if (end <= start) continue;
    out.push({ start: Math.round(start), dur: Math.round(end - start), pitch: n.pitch, velocity: Math.max(1, Math.min(127, n.velocity)), staff: 0, voice: 0 });
  }
  return out;
}

/**
 * Put a take into a track (staff 0) between `from` and `to` ticks. 'replace' removes the notes
 * that start in that range first; 'merge' keeps them.
 */
export function mergeTake(song: Song, trackIndex: number, notes: RollNote[], from: number, to: number, mode: 'replace' | 'merge' = 'merge'): Song {
  return editStaffNotes(song, trackIndex, 0, (evs) => [
    ...(mode === 'replace' ? evs.filter((e) => e.start < from || e.start >= to) : evs),
    ...notes,
  ]);
}

/** Step entry: put these pitches on the cursor beat (keeps its length). Fretted tracks get positions. */
export function setBeatPitches(song: Song, c: Cursor, pitches: number[], velocity = DEFAULT_VELOCITY, frets?: { string: number; fret: number }[]): Song {
  return editVoice(song, c, (beats, t) => {
    const b = beats[c.beat];
    if (!b) return;
    // Pairs (pitch, position) sorted low to high; duplicates dropped.
    const pairs = pitches.map((pitch, i) => ({ pitch, pos: frets?.[i] }))
      .filter((x, i, arr) => arr.findIndex((y) => y.pitch === x.pitch) === i)
      .sort((x, y) => x.pitch - y.pitch);
    const notes: Note[] = pairs.map((x) => ({ pitch: x.pitch, velocity }));
    if (isFretted(t)) {
      const given = pairs.every((x) => x.pos);
      const pos = given ? pairs.map((x) => x.pos!) : assignChord(pairs.map((x) => x.pitch), t.tuning!, { capo: t.capo ?? 0, aroundFret: 3 });
      notes.forEach((n, i) => {
        if (pos[i]) {
          n.string = pos[i]!.string;
          n.fret = pos[i]!.fret;
        }
      });
    }
    b.notes = notes;
  });
}
