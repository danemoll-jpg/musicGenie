// Standard MIDI file -> musicGenie model, via @tonejs/midi.
// MIDI has no notation, so notes are quantized to a 16th-note grid and written as
// tied, notatable durations. A single piano track spanning both hands is split into
// treble/bass staves at middle C.
import { Midi } from '@tonejs/midi';
import { newTrack } from '../model/factory';
import { PPQ, type BarHeader, type Beat, type Measure, type Note, type Song, type Staff } from '../model/types';
import { barTicks, splitTicks } from '../model/timing';

const GRID = PPQ / 4; // 16th note

interface RawNote {
  pitch: number;
  start: number; // model ticks
  end: number;
  velocity: number;
}

export interface MidiSourceCounts {
  tracks: number;
  measures: number;
  notes: number;
}

/** Counts straight from the MIDI file (for checking the import). */
export function midiSourceCounts(bytes: Uint8Array): MidiSourceCounts {
  const midi = new Midi(bytes);
  const withNotes = midi.tracks.filter((t) => t.notes.length);
  const lastTick = Math.max(0, ...withNotes.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));
  return {
    tracks: withNotes.length,
    measures: Math.ceil(midi.header.ticksToMeasures(lastTick) - 1e-9),
    notes: withNotes.reduce((a, t) => a + t.notes.length, 0),
  };
}

export function importMidi(bytes: Uint8Array, fileName = 'MIDI file'): Song {
  const midi = new Midi(bytes);
  const scale = PPQ / midi.header.ppq;
  const q = (t: number) => Math.round((t * scale) / GRID) * GRID;

  const sourceTracks = midi.tracks.filter((t) => t.notes.length > 0);
  const lastTick = Math.max(0, ...sourceTracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));

  // Bars from the time signature map.
  const ts = midi.header.timeSignatures.length
    ? [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
    : [{ ticks: 0, timeSignature: [4, 4] }];
  const ks = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks);
  const bars: BarHeader[] = [];
  const barStarts: number[] = [];
  const end = q(lastTick);
  let t = 0;
  while (t < end || bars.length === 0) {
    const sig = [...ts].reverse().find((s) => s.ticks * scale <= t + 1) ?? ts[0];
    const k = [...ks].reverse().find((s) => s.ticks * scale <= t + 1);
    const bar: BarHeader = {
      timeSignature: { numerator: sig.timeSignature[0], denominator: sig.timeSignature[1] },
      key: { fifths: k ? keyToFifths(k.key, k.scale) : 0, mode: k?.scale === 'minor' ? 'minor' : 'major' },
    };
    bars.push(bar);
    barStarts.push(t);
    t += barTicks(bar);
  }

  // Tempo map.
  const tempos: Song['tempos'] = [];
  for (const tm of midi.header.tempos) {
    const at = q(tm.ticks);
    let bi = barStarts.findIndex((s, i) => at >= s && (i === barStarts.length - 1 || at < barStarts[i + 1]));
    if (bi < 0) bi = 0;
    const bpm = Math.round(tm.bpm * 100) / 100;
    if (tempos.length && tempos[tempos.length - 1].bpm === bpm) continue;
    tempos.push({ bar: bi, tick: at - barStarts[bi], bpm });
  }
  if (!tempos.length || tempos[0].bar !== 0 || tempos[0].tick !== 0) tempos.unshift({ bar: 0, tick: 0, bpm: 120 });

  const tracks = sourceTracks.map((st, i) => {
    const raw: RawNote[] = st.notes.map((n) => {
      const start = q(n.ticks);
      return {
        pitch: n.midi,
        start,
        end: Math.max(start + GRID, q(n.ticks + n.durationTicks)),
        velocity: Math.max(1, Math.round(n.velocity * 127)),
      };
    });
    const percussion = st.instrument.percussion || st.channel === 9;
    const program = st.instrument.number;
    const isPiano = !percussion && program <= 7;
    const min = Math.min(...raw.map((r) => r.pitch));
    const max = Math.max(...raw.map((r) => r.pitch));
    let staves: Staff[];
    if (isPiano && min < 55 && max > 64 && sourceTracks.length === 1) {
      staves = [
        buildStaff(raw.filter((r) => r.pitch >= 60), bars, barStarts, 'treble'),
        buildStaff(raw.filter((r) => r.pitch < 60), bars, barStarts, 'bass'),
      ];
    } else {
      const avg = raw.reduce((a, r) => a + r.pitch, 0) / raw.length;
      staves = [buildStaff(raw, bars, barStarts, percussion ? 'neutral' : avg < 55 ? 'bass' : 'treble')];
    }
    const name = st.name?.trim() || st.instrument.name || `Track ${i + 1}`;
    return newTrack(`t${i + 1}`, name, program, percussion, staves);
  });

  return {
    title: midi.header.name?.trim() || fileName.replace(/\.(mid|midi)$/i, ''),
    artist: '', album: '', composer: '',
    bars, tempos, sections: [], chordSymbols: [], tracks,
  };
}

function keyToFifths(key: string, scale: string): number {
  const MAJOR: Record<string, number> = {
    Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  };
  const MINOR: Record<string, number> = {
    Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1, A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  };
  return (scale === 'minor' ? MINOR[key] : MAJOR[key]) ?? 0;
}

/**
 * One voice per staff: notes starting together form a chord; each chord lasts until the
 * next onset (or its longest note ends, then a rest). Long events are split at bar lines
 * and into notatable durations joined by ties.
 */
function buildStaff(raw: RawNote[], bars: BarHeader[], barStarts: number[], clef: Staff['clef']): Staff {
  // Group by onset, dedupe same pitch at same onset.
  const byStart = new Map<number, RawNote[]>();
  for (const r of raw) {
    const g = byStart.get(r.start) ?? [];
    const dup = g.find((x) => x.pitch === r.pitch);
    if (dup) dup.end = Math.max(dup.end, r.end);
    else g.push({ ...r });
    byStart.set(r.start, g);
  }
  const onsets = [...byStart.keys()].sort((a, b) => a - b);

  // Events: [start, end, notes|null]
  const events: { start: number; end: number; notes: RawNote[] | null }[] = [];
  let cursor = 0;
  onsets.forEach((on, i) => {
    if (on > cursor) events.push({ start: cursor, end: on, notes: null });
    const group = byStart.get(on)!.sort((a, b) => a.pitch - b.pitch);
    const next = i + 1 < onsets.length ? onsets[i + 1] : Infinity;
    const longest = Math.max(...group.map((g) => g.end));
    const stop = Math.min(next, longest);
    events.push({ start: on, end: stop, notes: group });
    cursor = stop;
  });
  const songEnd = barStarts[barStarts.length - 1] + barTicks(bars[bars.length - 1]);
  if (cursor < songEnd) events.push({ start: cursor, end: songEnd, notes: null });

  const measures: Measure[] = bars.map(() => ({ voices: [{ beats: [] }] }));
  for (const ev of events) {
    let s = ev.start;
    let first = true;
    while (s < ev.end) {
      const bi = barIndexAt(barStarts, s);
      const barEnd = barStarts[bi] + barTicks(bars[bi]);
      const segEnd = Math.min(ev.end, barEnd);
      for (const d of splitTicks(segEnd - s)) {
        const beat: Beat = { duration: d, notes: [] };
        if (ev.notes) {
          beat.notes = ev.notes.map((r): Note => {
            const n: Note = { pitch: r.pitch, velocity: r.velocity };
            if (!first) n.tieFromPrevious = true;
            return n;
          });
        }
        measures[bi].voices[0].beats.push(beat);
        first = false;
      }
      s = segEnd;
    }
  }
  return { clef, measures };
}

function barIndexAt(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
