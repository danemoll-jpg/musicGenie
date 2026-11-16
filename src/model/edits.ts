// Pure model edits: each takes a Song and returns a NEW Song (the input is never mutated).
import { assignChord } from './fretting';
import { findInstrument, toInstrumentRef } from './instruments';
import type { BackingTrack, DisplayMode, Mixer, Note, RocksmithExport, Song, Track } from './types';

export function cloneSong(song: Song): Song {
  return structuredClone(song);
}

function mapTrack(song: Song, trackId: string, fn: (t: Track) => void): Song {
  const next = cloneSong(song);
  const t = next.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error(`No track with id ${trackId}`);
  fn(t);
  return next;
}

/** Change what plays a track. Notes are never touched; only instrument (and tuning for fretted instruments). */
export function setInstrument(song: Song, trackId: string, instrumentId: string): Song {
  const c = findInstrument(instrumentId);
  if (!c) throw new Error(`Unknown instrument ${instrumentId}`);
  return mapTrack(song, trackId, (t) => {
    t.instrument = toInstrumentRef(c);
    if (c.tuning) {
      // Keep an existing tuning with the same string count (e.g. drop-D stays drop-D).
      if (!t.tuning || t.tuning.length !== c.tuning.length) t.tuning = [...c.tuning];
      t.displayTranspose = c.displayTranspose ?? 0;
    } else {
      delete t.tuning;
      delete t.capo;
      t.displayTranspose = 0;
      if (t.display.mode !== 'notation') t.display.mode = 'notation';
    }
  });
}

export function setMixer(song: Song, trackId: string, patch: Partial<Mixer>): Song {
  return mapTrack(song, trackId, (t) => Object.assign(t.mixer, patch));
}

export function setDisplay(song: Song, trackId: string, patch: { visible?: boolean; mode?: DisplayMode }): Song {
  return mapTrack(song, trackId, (t) => Object.assign(t.display, patch));
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};

export function transposeFifths(fifths: number, semitones: number): number {
  const tonic = (((fifths * 7) % 12) + 12) % 12; // major-key tonic pitch class
  const newTonic = (((tonic + semitones) % 12) + 12) % 12;
  let f = (newTonic * 7) % 12; // pitch class -> fifths (7 is its own inverse mod 12)
  if (f > 6) f -= 12;
  return f;
}

export function transposeChordName(name: string, semitones: number, preferFlats: boolean): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const shift = (root: string) => {
    const pc = PC[root];
    if (pc === undefined) return root;
    return names[(((pc + semitones) % 12) + 12) % 12];
  };
  const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(name.trim());
  if (!m) return name;
  return shift(m[1]) + m[2] + (m[3] ? '/' + shift(m[3]) : '');
}

function transposeTrackNotes(t: Track, semitones: number) {
  const tuning = t.tuning;
  for (const staff of t.staves) {
    for (const measure of staff.measures) {
      for (const voice of measure.voices) {
        for (const beat of voice.beats) {
          for (const n of beat.notes) n.pitch = Math.max(0, Math.min(127, n.pitch + semitones));
          if (tuning && !t.instrument.percussion) refretBeat(beat.notes, tuning, t.capo ?? 0, semitones);
        }
      }
    }
  }
}

/** After a pitch change, keep each note on its string if still playable, else re-place the whole chord. */
function refretBeat(notes: Note[], tuning: number[], capo: number, semitones: number) {
  const fretted = notes.filter((n) => n.string !== undefined && n.fret !== undefined);
  if (!fretted.length) return;
  const stays = fretted.every((n) => {
    const open = tuning[n.string! - 1];
    const f = n.pitch - (open ?? 0);
    return open !== undefined && f >= capo && f <= 24;
  });
  if (stays) {
    for (const n of fretted) n.fret = n.pitch - tuning[n.string! - 1];
    return;
  }
  const oldFrets = fretted.map((n) => n.fret! + semitones).filter((f) => f > 0);
  const around = oldFrets.length ? oldFrets.reduce((a, b) => a + b, 0) / oldFrets.length : 3;
  const pos = assignChord(fretted.map((n) => n.pitch), tuning, { capo, aroundFret: Math.max(0, around) });
  fretted.forEach((n, i) => {
    const p = pos[i];
    if (p) {
      n.string = p.string;
      n.fret = p.fret;
    } else {
      delete n.string;
      delete n.fret;
    }
  });
}

/**
 * Transpose by semitones. With a trackId, only that track; otherwise the whole song
 * (all pitched tracks, key signatures and chord symbols). Drum tracks are never transposed.
 */
export function transpose(song: Song, semitones: number, trackId?: string): Song {
  if (!semitones) return song;
  const next = cloneSong(song);
  for (const t of next.tracks) {
    if (t.instrument.percussion) continue;
    if (trackId && t.id !== trackId) continue;
    transposeTrackNotes(t, semitones);
  }
  if (!trackId) {
    for (const b of next.bars) b.key.fifths = transposeFifths(b.key.fifths, semitones);
    next.chordSymbols = next.chordSymbols.map((c) => {
      const fifths = next.bars[c.bar]?.key.fifths ?? 0;
      return { ...c, name: transposeChordName(c.name, semitones, fifths < 0) };
    });
  }
  return next;
}

/** Every note in the song in a stable order (used by tests and counts). */
export function allNotes(song: Song): Note[] {
  const out: Note[] = [];
  for (const t of song.tracks)
    for (const s of t.staves)
      for (const m of s.measures) for (const v of m.voices) for (const b of v.beats) out.push(...b.notes);
  return out;
}

/** Count of sounded notes (tie continuations are not new notes). */
export function countNoteOnsets(song: Song, trackIndex?: number): number {
  const tracks = trackIndex === undefined ? song.tracks : [song.tracks[trackIndex]];
  let n = 0;
  for (const t of tracks)
    for (const s of t.staves)
      for (const m of s.measures)
        for (const v of m.voices) for (const b of v.beats) n += b.notes.filter((x) => !x.tieFromPrevious).length;
  return n;
}

/** Change playback settings (swing, SoundFont). `soundFont: null` removes the song's own SoundFont. */
export function setPlayback(song: Song, patch: { swing?: number; soundFont?: string | null }): Song {
  const next = cloneSong(song);
  const pb = { swing: 0, ...(next.playback ?? {}) };
  if (patch.swing !== undefined) pb.swing = Math.max(0, Math.min(1, patch.swing));
  if (patch.soundFont === null) delete pb.soundFont;
  else if (patch.soundFont !== undefined) pb.soundFont = patch.soundFont;
  next.playback = pb;
  return next;
}

/** Change the backing track (volume, mute, offset), or remove it with null. */
export function setBacking(song: Song, patch: Partial<BackingTrack> | null): Song {
  const next = cloneSong(song);
  if (patch === null) delete next.backing;
  else if (next.backing) Object.assign(next.backing, patch);
  else if (patch.path) next.backing = { name: 'Recording', offsetMs: 0, volume: 0.8, mute: false, ...patch, path: patch.path };
  return next;
}

/** Remember the Rocksmith export settings in the song. */
export function setRocksmithExport(song: Song, s: RocksmithExport): Song {
  const next = cloneSong(song);
  next.rocksmith = structuredClone(s);
  return next;
}
