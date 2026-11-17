// Audio -> notes -> a new track (Round 6). Pure. Notes come in as RECORDING seconds and are put on
// the song's tempo map through the clip they came from, quantised to a grid (or kept loose =
// 1/64 grid), kept within the instrument's range; fretted tracks get playable string/fret
// positions (buildMeasures -> assignChord); drum hits become GM drum notes.
import { applyDetectedChords, detectChords } from './chords';
import { cloneSong } from './edits';
import { buildMeasures, type NoteEvent } from './events';
import { newTrack } from './factory';
import { instrumentForProgram, INSTRUMENTS } from './instruments';
import { layoutVoices } from './pianoRoll';
import { restMeasure } from './noteEdit';
import { msAtTick, tempoPoints, tickAtMs } from './tempo';
import { barStartTicks, barTicks } from './timing';
import { PPQ, type Song, type Track } from './types';

export interface AudioNote {
  startS: number;
  endS: number;
  pitch: number;
  amplitude: number;
}

export const GRIDS: { id: string; label: string; ticks: number }[] = [
  { id: '1/4', label: 'Quarter', ticks: PPQ },
  { id: '1/8', label: 'Eighth', ticks: PPQ / 2 },
  { id: '1/8t', label: 'Eighth triplet', ticks: PPQ / 3 },
  { id: '1/16', label: 'Sixteenth', ticks: PPQ / 4 },
  { id: '1/16t', label: 'Sixteenth triplet', ticks: PPQ / 6 },
  { id: '1/32', label: 'Thirty-second', ticks: PPQ / 8 },
];
const LOOSE = PPQ / 16; // 1/64

export interface PartKind {
  id: string;
  label: string;
  instrumentId: string;
  /** Lowest / highest playable pitch. */
  range: [number, number];
  mono: boolean;
}

export const PART_KINDS: PartKind[] = [
  { id: 'bass', label: 'Bass (4 strings)', instrumentId: 'fingered-bass', range: [28, 67], mono: true },
  { id: 'guitar', label: 'Guitar (6 strings)', instrumentId: 'overdrive-guitar', range: [40, 88], mono: false },
  { id: 'lead', label: 'Lead guitar (single notes)', instrumentId: 'overdrive-guitar', range: [40, 88], mono: true },
  { id: 'piano', label: 'Piano', instrumentId: 'acoustic-grand-piano', range: [21, 108], mono: false },
  { id: 'vocals', label: 'Melody (voice)', instrumentId: 'acoustic-grand-piano', range: [40, 84], mono: true },
];

/** Song ms of a recording time (seconds) for a clip at bar/tick that starts at `startMs` in its file. */
export function recToSongMs(song: Song, clip: { bar: number; tick: number; startMs: number }, s: number): number {
  const c0 = msAtTick(tempoPoints(song), (barStartTicks(song)[clip.bar] ?? 0) + clip.tick);
  return c0 + s * 1000 - clip.startMs;
}

function freeTrackId(song: Song, base: string): string {
  let id = base;
  for (let k = 2; song.tracks.some((t) => t.id === id); k++) id = base + k;
  return id;
}

export interface TranscribeOptions {
  kind: string;
  grid: string;
  loose: boolean;
  name?: string;
  sourceTrackId?: string;
  /** Add chord symbols from the new notes (guitar/piano). Default true for chordal parts. */
  chords?: boolean;
  /** Round 7: detected tuning (lowest string first) and how far the recording is from A440 (cents). */
  tuning?: number[];
  centOffset?: number;
}

/** Notes (seconds in the recording) -> events on the song's tick grid. */
export function audioNotesToEvents(song: Song, clip: { bar: number; tick: number; startMs: number; lengthMs?: number }, notes: AudioNote[], opts: { grid: string; loose: boolean; range: [number, number]; mono: boolean }): NoteEvent[] {
  const pts = tempoPoints(song);
  const starts = barStartTicks(song);
  const total = starts[starts.length - 1] + barTicks(song.bars[song.bars.length - 1]);
  const g = opts.loose ? LOOSE : GRIDS.find((x) => x.id === opts.grid)?.ticks ?? PPQ / 4;
  const q = (t: number) => Math.round(t / g) * g;
  const [lo, hi] = opts.range;
  const maxAmp = Math.max(1e-6, ...notes.map((n) => n.amplitude));
  let ev: (NoteEvent & { amp: number })[] = [];
  for (const n of notes) {
    if (clip.lengthMs !== undefined && (n.startS * 1000 < clip.startMs || n.startS * 1000 > clip.startMs + clip.lengthMs)) continue;
    let p = n.pitch;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    const s = q(tickAtMs(pts, recToSongMs(song, clip, n.startS)));
    let e = q(tickAtMs(pts, recToSongMs(song, clip, n.endS)));
    if (e <= s) e = s + g;
    if (s < 0 || s >= total) continue;
    ev.push({ start: s, dur: Math.min(e, total) - s, pitch: p, velocity: Math.round(50 + 70 * Math.min(1, n.amplitude / maxAmp)), staff: 0, voice: 0, amp: n.amplitude });
  }
  // Same pitch twice at one start: keep one.
  const seen = new Map<string, NoteEvent & { amp: number }>();
  for (const e of ev) {
    const k = e.start + ':' + e.pitch;
    const o = seen.get(k);
    if (!o || e.amp > o.amp) seen.set(k, e);
  }
  ev = [...seen.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  if (opts.mono) {
    // One note at a time: the strongest note at each start; a note ends where the next begins.
    // At each start keep the LOWEST note that is reasonably strong: the notes above it are
    // usually its harmonics (an octave or a twelfth up on a bass).
    const groups = new Map<number, (NoteEvent & { amp: number })[]>();
    for (const e of ev) groups.set(e.start, [...(groups.get(e.start) ?? []), e]);
    ev = [...groups.values()].map((g) => {
      const max = Math.max(...g.map((e) => e.amp));
      return g.filter((e) => e.amp >= 0.5 * max).sort((a, b) => a.pitch - b.pitch)[0];
    }).sort((a, b) => a.start - b.start);
    // A note right after the same pitch that only rings on (no gap) is merged when quantising
    // made them touch and the later one is much weaker.
    const merged: (NoteEvent & { amp: number })[] = [];
    for (const e of ev) {
      const p = merged[merged.length - 1];
      if (p && p.pitch === e.pitch && p.start + p.dur >= e.start && e.amp < 0.35 * p.amp) { p.dur = Math.max(p.dur, e.start + e.dur - p.start); continue; }
      merged.push(e);
    }
    ev = merged;
    for (let i = 0; i + 1 < ev.length; i++) ev[i].dur = Math.min(ev[i].dur, ev[i + 1].start - ev[i].start);
  } else {
    // Same pitch overlapping itself: cut the earlier note.
    const last = new Map<number, NoteEvent>();
    for (const e of ev) {
      const o = last.get(e.pitch);
      if (o && o.start + o.dur > e.start) o.dur = Math.max(g, e.start - o.start);
      last.set(e.pitch, e);
    }
  }
  return ev.filter((e) => e.dur > 0).map(({ amp, ...e }) => { void amp; return e; });
}

function writeTrack(song: Song, t: Track, events: NoteEvent[]): Track {
  const voices = layoutVoices(events, t.instrument.percussion);
  const built = voices.map((v) => buildMeasures(song, v, { percussion: t.instrument.percussion, tuning: t.tuning, capo: t.capo ?? 0 }));
  if (!built.length) return t;
  t.staves = [{
    ...t.staves[0],
    measures: song.bars.map((_, b) => {
      const vs = built.map((m) => m[b].voices[0]);
      let lastV = 0;
      vs.forEach((v, vi) => { if (v.beats.some((x) => x.notes.length)) lastV = vi; });
      return { voices: vs.slice(0, lastV + 1) };
    }),
  }];
  return t;
}

/** A new track from transcribed notes. Returns the song and the new track id. */
export function addTranscribedTrack(song: Song, clip: { bar: number; tick: number; startMs: number; lengthMs?: number }, notes: AudioNote[], opts: TranscribeOptions): { song: Song; id: string; notes: number } {
  const kind = PART_KINDS.find((k) => k.id === opts.kind) ?? PART_KINDS[0];
  const cat = INSTRUMENTS.find((i) => i.id === kind.instrumentId) ?? instrumentForProgram(0, false);
  const out = cloneSong(song);
  const id = freeTrackId(out, 'tx-' + kind.id);
  const t = newTrack(id, opts.name ?? kind.label.split(' (')[0] + ' (from audio)', cat.program, false, [{
    clef: kind.id === 'bass' ? 'bass' : 'treble', measures: out.bars.map(() => ({ voices: [{ beats: [] }] })),
  }]);
  t.instrument.id = cat.id;
  if (kind.id === 'bass' || kind.id === 'guitar' || kind.id === 'lead') {
    t.display.mode = kind.id === 'bass' ? 'tab' : 'both';
  }
  t.analysis = { kind: 'transcription', sourceTrackId: opts.sourceTrackId, grid: opts.grid, loose: opts.loose };
  if (opts.tuning && t.tuning && opts.tuning.length === t.tuning.length) t.tuning = opts.tuning.slice();
  if (opts.centOffset && Math.abs(opts.centOffset) >= 5 && t.tuning) t.rocksmith = { arrangement: kind.id === 'bass' ? 'Bass' : 'Lead', centOffset: Math.round(opts.centOffset) };
  const events = audioNotesToEvents(out, clip, notes, { grid: opts.grid, loose: opts.loose, range: kind.range, mono: kind.mono });
  writeTrack(out, t, events);
  // Bars with no notes still need a rest measure.
  t.staves[0].measures = t.staves[0].measures.map((m, b) => (m.voices.length && m.voices[0].beats.length ? m : restBar(out, b)));
  out.tracks.push(t);
  let s = out;
  if (opts.chords ?? !kind.mono) {
    const det = detectChords(s, { trackIds: [id] });
    s = applyDetectedChords(s, det, false);
  }
  return { song: s, id, notes: events.length };
}

function restBar(song: Song, b: number) {
  return restMeasure(song.bars[b]);
}

export interface DrumHitIn {
  t: number;
  piece: string;
  vel: number;
}

const GM: Record<string, number> = { kick: 36, snare: 38, hhClosed: 42, hhOpen: 46, tomLow: 45, tomMid: 47, tomHigh: 50, crash: 49, ride: 51 };

/** A new drum track from drum hits (recording seconds). */
export function addDrumTranscription(song: Song, clip: { bar: number; tick: number; startMs: number; lengthMs?: number }, hits: DrumHitIn[], opts: { grid: string; loose: boolean; sourceTrackId?: string; name?: string }): { song: Song; id: string; notes: number } {
  const out = cloneSong(song);
  const id = freeTrackId(out, 'tx-drums');
  const t = newTrack(id, opts.name ?? 'Drums (from audio)', 0, true, [{ clef: 'neutral', measures: out.bars.map(() => ({ voices: [{ beats: [] }] })) }]);
  t.analysis = { kind: 'transcription', stem: 'drums', sourceTrackId: opts.sourceTrackId, grid: opts.grid, loose: opts.loose };
  const pts = tempoPoints(out);
  const starts = barStartTicks(out);
  const total = starts[starts.length - 1] + barTicks(out.bars[out.bars.length - 1]);
  const g = opts.loose ? LOOSE : GRIDS.find((x) => x.id === opts.grid)?.ticks ?? PPQ / 4;
  const seen = new Set<string>();
  const ev: NoteEvent[] = [];
  for (const h of hits) {
    if (clip.lengthMs !== undefined && (h.t * 1000 < clip.startMs || h.t * 1000 > clip.startMs + clip.lengthMs)) continue;
    const s = Math.round(tickAtMs(pts, recToSongMs(out, clip, h.t)) / g) * g;
    const p = GM[h.piece];
    if (p === undefined || s < 0 || s >= total || seen.has(s + ':' + p)) continue;
    seen.add(s + ':' + p);
    ev.push({ start: s, dur: Math.min(g, total - s), pitch: p, velocity: Math.round(40 + 87 * h.vel), staff: 0, voice: 0 });
  }
  writeTrack(out, t, ev);
  t.staves[0].measures = t.staves[0].measures.map((m, b) => (m.voices.length && m.voices[0].beats.length ? m : restBar(out, b)));
  out.tracks.push(t);
  return { song: out, id, notes: ev.length };
}
