// Piano roll editing: notes as absolute-time events (start/length/pitch/velocity). Every edit
// rebuilds only the bars it touches from the edited event list, so the score, the tab and the
// piano roll all show the same model. Pure: Song in, new Song out.
import { cloneSong } from './edits';
import { buildMeasures, trackEvents, type NoteEvent } from './events';
import { isFretted } from './noteEdit';
import { barStartTicks, barTicks } from './timing';
import { PPQ, type Measure, type Song } from './types';

export type RollNote = NoteEvent;

/** Snap grid choices (ticks per cell). */
export const SNAPS: { id: string; label: string; ticks: number }[] = [
  { id: '4', label: '1/4', ticks: PPQ },
  { id: '8', label: '1/8', ticks: PPQ / 2 },
  { id: '16', label: '1/16', ticks: PPQ / 4 },
  { id: '32', label: '1/32', ticks: PPQ / 8 },
  { id: '4T', label: '1/4 triplet', ticks: (PPQ * 2) / 3 },
  { id: '8T', label: '1/8 triplet', ticks: PPQ / 3 },
  { id: '16T', label: '1/16 triplet', ticks: PPQ / 6 },
  { id: 'off', label: 'off (1/64)', ticks: PPQ / 16 },
];

export function snapTicks(id: string): number {
  return SNAPS.find((s) => s.id === id)?.ticks ?? PPQ / 4;
}

export function snap(tick: number, grid: number): number {
  return Math.round(tick / grid) * grid;
}

/** The notes of one staff of a track, in time order (index = note id for the edits below). */
export function staffNotes(song: Song, trackIndex: number, staff = 0): RollNote[] {
  const t = song.tracks[trackIndex];
  if (!t) return [];
  return trackEvents(song, t).filter((e) => e.staff === staff);
}

/** Bar index containing an absolute tick. */
export function barAtTick(song: Song, tick: number): number {
  const starts = barStartTicks(song);
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= tick) i++;
  return i;
}

export function songTicks(song: Song): number {
  return song.bars.reduce((a, b) => a + barTicks(b), 0);
}

/**
 * Split events into voices: a voice never has overlapping notes, except notes that start AND end
 * together (a chord). Drums use one voice (their lengths don't matter).
 */
export function layoutVoices(events: RollNote[], percussion = false): RollNote[][] {
  if (percussion) return [events.slice()];
  const sorted = [...events].sort((a, b) => a.start - b.start || b.dur - a.dur || a.pitch - b.pitch);
  const voices: { end: number; lastStart: number; lastDur: number; ev: RollNote[] }[] = [];
  for (const e of sorted) {
    let v = voices.find((x) => (x.lastStart === e.start && x.lastDur === e.dur) || x.end <= e.start);
    if (v && v.lastStart === e.start && v.lastDur === e.dur && v.ev.some((x) => x.start === e.start && x.pitch === e.pitch)) v = undefined;
    if (!v) {
      v = { end: 0, lastStart: -1, lastDur: -1, ev: [] };
      voices.push(v);
    }
    v.ev.push(e);
    v.end = Math.max(v.end, e.start + e.dur);
    v.lastStart = e.start;
    v.lastDur = e.dur;
  }
  return voices.length ? voices.map((v) => v.ev) : [[]];
}

/** Bars touched by a set of events (start bar .. bar of the last tick). */
function touchedBars(song: Song, evs: RollNote[], into: Set<number>) {
  for (const e of evs) {
    const a = barAtTick(song, e.start);
    const b = barAtTick(song, Math.max(e.start, e.start + e.dur - 1));
    for (let i = a; i <= b; i++) into.add(i);
  }
}

/**
 * Replace the notes of a staff with `next`. Only bars where something changed are rebuilt
 * (changed = an event was added, removed or altered there). Fretted tracks: events without
 * string/fret get playable positions (capo respected).
 */
export function setStaffNotes(song: Song, trackIndex: number, staff: number, next: RollNote[], prev?: RollNote[]): Song {
  const before = prev ?? staffNotes(song, trackIndex, staff);
  const key = (e: RollNote) => JSON.stringify([e.start, e.dur, e.pitch, e.velocity, e.string, e.fret, e.techniques ?? null]);
  const beforeKeys = new Map<string, number>();
  for (const e of before) beforeKeys.set(key(e), (beforeKeys.get(key(e)) ?? 0) + 1);
  const added: RollNote[] = [];
  for (const e of next) {
    const k = key(e);
    const n = beforeKeys.get(k) ?? 0;
    if (n > 0) beforeKeys.set(k, n - 1);
    else added.push(e);
  }
  const removed = before.filter((e) => {
    const k = key(e);
    const n = beforeKeys.get(k) ?? 0;
    if (n > 0) {
      beforeKeys.set(k, n - 1);
      return true;
    }
    return false;
  });
  const bars = new Set<number>();
  touchedBars(song, added, bars);
  touchedBars(song, removed, bars);
  if (!bars.size) return song;

  const out = cloneSong(song);
  const t = out.tracks[trackIndex];
  const total = songTicks(out);
  const clean = next
    .filter((e) => e.dur > 0 && e.start >= 0 && e.start < total)
    .map((e) => ({ ...e, staff, dur: Math.min(e.dur, total - e.start), pitch: Math.max(0, Math.min(127, Math.round(e.pitch))) }));
  // Notes crossing into or out of a rebuilt bar are rebuilt whole (their ties stay in one voice).
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of clean) {
      const a = barAtTick(out, e.start);
      const b = barAtTick(out, Math.max(e.start, e.start + e.dur - 1));
      if (a === b) continue;
      let hit = false;
      for (let i = a; i <= b && !hit; i++) hit = bars.has(i);
      if (!hit) continue;
      for (let i = a; i <= b; i++) if (!bars.has(i)) { bars.add(i); grew = true; }
    }
  }
  const voices = layoutVoices(clean, t.instrument.percussion);
  const fretted = isFretted(t);
  const opts = { percussion: t.instrument.percussion, tuning: fretted ? t.tuning : undefined, capo: t.capo ?? 0 };
  const sortedBars = [...bars].sort((a, b) => a - b);
  // Rebuild runs of consecutive touched bars.
  for (let i = 0; i < sortedBars.length; ) {
    let j = i;
    while (j + 1 < sortedBars.length && sortedBars[j + 1] === sortedBars[j] + 1) j++;
    const from = sortedBars[i];
    const to = sortedBars[j] + 1;
    const built = voices.map((v) => buildMeasures(out, v, { ...opts, fromBar: from, toBar: to }));
    for (let b = from; b < to; b++) {
      const vs = built.map((m) => m[b - from].voices[0]);
      let last = 0;
      vs.forEach((v, vi) => {
        if (v.beats.some((x) => x.notes.length)) last = vi;
      });
      const m: Measure = { voices: vs.slice(0, last + 1) };
      t.staves[staff].measures[b] = m;
    }
    i = j + 1;
  }
  return out;
}

/** Apply a change to the event list of a staff (one undoable edit in the app). */
export function editStaffNotes(song: Song, trackIndex: number, staff: number, fn: (notes: RollNote[]) => RollNote[]): Song {
  const before = staffNotes(song, trackIndex, staff);
  const next = fn(before.map((e) => ({ ...e })));
  return setStaffNotes(song, trackIndex, staff, next, before);
}

/** Add a note. Fretted tracks: string/fret are chosen automatically. */
export function addRollNote(song: Song, trackIndex: number, staff: number, n: { start: number; dur: number; pitch: number; velocity?: number }): Song {
  return editStaffNotes(song, trackIndex, staff, (evs) => [
    ...evs.filter((e) => !(e.start === n.start && e.pitch === n.pitch)),
    { start: n.start, dur: n.dur, pitch: n.pitch, velocity: n.velocity ?? 96, staff, voice: 0 },
  ]);
}

/** Move notes by ticks and semitones. A pitch change drops the old string/fret (re-placed). */
export function moveRollNotes(song: Song, trackIndex: number, staff: number, ids: number[], dTick: number, dPitch: number): Song {
  if (!dTick && !dPitch) return song;
  const set = new Set(ids);
  return editStaffNotes(song, trackIndex, staff, (evs) =>
    evs.map((e, i) => {
      if (!set.has(i)) return e;
      const m: RollNote = { ...e, start: Math.max(0, e.start + dTick), pitch: e.pitch + dPitch };
      if (dPitch) {
        delete m.string;
        delete m.fret;
      }
      return m;
    }),
  );
}

/** Set the length of notes (minimum one 64th). */
export function resizeRollNotes(song: Song, trackIndex: number, staff: number, ids: number[], dur: number | ((old: number) => number)): Song {
  const set = new Set(ids);
  return editStaffNotes(song, trackIndex, staff, (evs) =>
    evs.map((e, i) => (set.has(i) ? { ...e, dur: Math.max(PPQ / 16, typeof dur === 'function' ? dur(e.dur) : dur) } : e)),
  );
}

export function deleteRollNotes(song: Song, trackIndex: number, staff: number, ids: number[]): Song {
  const set = new Set(ids);
  return editStaffNotes(song, trackIndex, staff, (evs) => evs.filter((_, i) => !set.has(i)));
}

export function setRollVelocity(song: Song, trackIndex: number, staff: number, ids: number[], velocity: number): Song {
  const set = new Set(ids);
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  return editStaffNotes(song, trackIndex, staff, (evs) => evs.map((e, i) => (set.has(i) ? { ...e, velocity: v } : e)));
}
