// Tuning presets, custom tunings and capo for fretted tracks.
import { cloneSong } from './edits';
import { assignChord, MAX_FRET } from './fretting';
import type { Song, Track } from './types';

export interface TuningPreset {
  id: string;
  name: string;
  /** Open-string MIDI pitches, lowest string first. */
  pitches: number[];
}

// MIDI: E2 = 40, A2 = 45, D3 = 50, G3 = 55, B3 = 59, E4 = 64; bass E1 = 28.
export const GUITAR_TUNINGS: TuningPreset[] = [
  { id: 'standard', name: 'Standard (E A D G B E)', pitches: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', name: 'Drop D (D A D G B E)', pitches: [38, 45, 50, 55, 59, 64] },
  { id: 'eb-standard', name: 'E♭ Standard', pitches: [39, 44, 49, 54, 58, 63] },
  { id: 'drop-db', name: 'Drop D♭ (D♭ A♭ D♭ G♭ B♭ E♭)', pitches: [37, 44, 49, 54, 58, 63] },
  { id: 'd-standard', name: 'D Standard', pitches: [38, 43, 48, 53, 57, 62] },
  { id: 'drop-c', name: 'Drop C (C G C F A D)', pitches: [36, 43, 48, 53, 57, 62] },
  { id: 'c-standard', name: 'C Standard', pitches: [36, 41, 46, 51, 55, 60] },
  { id: 'drop-b', name: 'Drop B (B F# B E G# C#)', pitches: [35, 42, 47, 52, 56, 61] },
  { id: 'open-g', name: 'Open G (D G D G B D)', pitches: [38, 43, 50, 55, 59, 62] },
  { id: 'open-d', name: 'Open D (D A D F# A D)', pitches: [38, 45, 50, 54, 57, 62] },
  { id: 'open-e', name: 'Open E (E B E G# B E)', pitches: [40, 47, 52, 56, 59, 64] },
  { id: 'open-a', name: 'Open A (E A E A C# E)', pitches: [40, 45, 52, 57, 61, 64] },
  { id: 'open-c', name: 'Open C (C G C G C E)', pitches: [36, 43, 48, 55, 60, 64] },
  { id: 'dadgad', name: 'DADGAD', pitches: [38, 45, 50, 55, 57, 62] },
];

export const BASS_TUNINGS: TuningPreset[] = [
  { id: 'standard', name: 'Standard (E A D G)', pitches: [28, 33, 38, 43] },
  { id: 'drop-d', name: 'Drop D (D A D G)', pitches: [26, 33, 38, 43] },
  { id: 'eb-standard', name: 'E♭ Standard', pitches: [27, 32, 37, 42] },
  { id: 'd-standard', name: 'D Standard', pitches: [26, 31, 36, 41] },
  { id: 'drop-c', name: 'Drop C (C G C F)', pitches: [24, 31, 36, 41] },
  { id: 'c-standard', name: 'C Standard', pitches: [24, 29, 34, 39] },
];

export const FIVE_STRING_BASS: TuningPreset[] = [{ id: 'standard', name: 'Standard (B E A D G)', pitches: [23, 28, 33, 38, 43] }];
export const SEVEN_STRING_GUITAR: TuningPreset[] = [{ id: 'standard', name: 'Standard (B E A D G B E)', pitches: [35, 40, 45, 50, 55, 59, 64] }];

/** Presets that fit a track (same string count, guitar vs bass by range). */
export function tuningPresetsFor(t: Track): TuningPreset[] {
  const n = t.tuning?.length ?? 0;
  const bass = (t.tuning?.[0] ?? 40) < 34 || t.instrument.id.includes('bass');
  if (n === 6) return GUITAR_TUNINGS;
  if (n === 4) return BASS_TUNINGS;
  if (n === 5 && bass) return FIVE_STRING_BASS;
  if (n === 7) return SEVEN_STRING_GUITAR;
  return [];
}

/** The preset matching a tuning exactly, if any. */
export function presetFor(t: Track): TuningPreset | undefined {
  const s = JSON.stringify(t.tuning ?? []);
  return tuningPresetsFor(t).find((p) => JSON.stringify(p.pitches) === s);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function pitchName(p: number): string {
  return NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
}

/**
 * Change a track's tuning.
 * keepPitch: the notes sound the same; frets are re-placed (string kept when possible).
 * keepFrets: the frets stay; the notes sound in the new tuning.
 */
export function setTuning(song: Song, trackId: string, tuning: number[], mode: 'keepPitch' | 'keepFrets'): Song {
  const next = cloneSong(song);
  const t = next.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error(`No track with id ${trackId}`);
  if (!t.tuning) throw new Error('Only guitar and bass tracks have a tuning.');
  if (tuning.length !== t.tuning.length) throw new Error(`This track has ${t.tuning.length} strings; the tuning has ${tuning.length}.`);
  const capo = t.capo ?? 0;
  t.tuning = [...tuning];
  for (const s of t.staves) {
    for (const m of s.measures) {
      for (const v of m.voices) {
        let around = 3;
        for (const b of v.beats) {
          const fretted = b.notes.filter((n) => n.string !== undefined && n.fret !== undefined);
          if (!fretted.length) continue;
          if (mode === 'keepFrets') {
            for (const n of fretted) n.pitch = tuning[n.string! - 1] + n.fret!;
          } else {
            const fits = fretted.every((n) => {
              const f = n.pitch - tuning[n.string! - 1];
              return f >= capo && f <= MAX_FRET;
            });
            if (fits) {
              for (const n of fretted) n.fret = n.pitch - tuning[n.string! - 1];
            } else {
              const pos = assignChord(fretted.map((n) => n.pitch), tuning, { capo, aroundFret: around });
              fretted.forEach((n, i) => {
                if (pos[i]) {
                  n.string = pos[i]!.string;
                  n.fret = pos[i]!.fret;
                } else {
                  delete n.string;
                  delete n.fret;
                }
              });
            }
          }
          const fs = fretted.map((n) => n.fret).filter((f): f is number => f !== undefined && f > 0);
          if (fs.length) around = fs.reduce((a, b2) => a + b2, 0) / fs.length;
        }
      }
    }
  }
  return next;
}

/**
 * Set the capo (0 = none). Frets count from the nut, so every note keeps its pitch; a chord with a
 * note below the new capo is re-placed on other strings when it can be, else left as it was.
 */
export function setCapo(song: Song, trackId: string, capo: number): Song {
  const next = cloneSong(song);
  const t = next.tracks.find((x) => x.id === trackId);
  if (!t?.tuning) throw new Error('Only guitar and bass tracks can have a capo.');
  const c = Math.max(0, Math.min(12, Math.round(capo)));
  if (c) t.capo = c;
  else delete t.capo;
  for (const s of t.staves) {
    for (const m of s.measures) {
      for (const v of m.voices) {
        for (const b of v.beats) {
          const fretted = b.notes.filter((n) => n.string !== undefined && n.fret !== undefined);
          if (!fretted.some((n) => n.fret! < c)) continue;
          const pos = assignChord(fretted.map((n) => n.pitch), t.tuning, { capo: c, aroundFret: c + 2 });
          fretted.forEach((n, i) => {
            if (pos[i]) {
              n.string = pos[i]!.string;
              n.fret = pos[i]!.fret;
            }
          });
        }
      }
    }
  }
  return next;
}
