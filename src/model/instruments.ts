import type { Instrument } from './types';

export type InstrumentGroup =
  | 'Keys'
  | 'Guitars'
  | 'Basses'
  | 'Strings'
  | 'Brass'
  | 'Winds'
  | 'Synths'
  | 'Drums';

export interface CatalogInstrument {
  id: string;
  name: string;
  group: InstrumentGroup;
  program: number;
  percussion?: boolean;
  /** Default tuning (lowest string first) for fretted instruments. */
  tuning?: number[];
  /** Notation display shift in semitones (guitar/bass are written an octave above sounding pitch). */
  displayTranspose?: number;
}

export const GUITAR_STANDARD = [40, 45, 50, 55, 59, 64];
export const BASS_STANDARD = [28, 33, 38, 43];

const g = (id: string, name: string, program: number): CatalogInstrument => ({
  id, name, group: 'Guitars', program, tuning: GUITAR_STANDARD, displayTranspose: -12,
});
const b = (id: string, name: string, program: number): CatalogInstrument => ({
  id, name, group: 'Basses', program, tuning: BASS_STANDARD, displayTranspose: -12,
});

export const INSTRUMENTS: CatalogInstrument[] = [
  { id: 'acoustic-grand-piano', name: 'Grand Piano', group: 'Keys', program: 0 },
  { id: 'bright-piano', name: 'Bright Piano', group: 'Keys', program: 1 },
  { id: 'electric-piano', name: 'Electric Piano', group: 'Keys', program: 4 },
  { id: 'harpsichord', name: 'Harpsichord', group: 'Keys', program: 6 },
  { id: 'vibraphone', name: 'Vibraphone', group: 'Keys', program: 11 },
  { id: 'marimba', name: 'Marimba', group: 'Keys', program: 12 },
  { id: 'drawbar-organ', name: 'Organ', group: 'Keys', program: 16 },
  { id: 'rock-organ', name: 'Rock Organ', group: 'Keys', program: 18 },
  { id: 'accordion', name: 'Accordion', group: 'Keys', program: 21 },
  g('nylon-guitar', 'Nylon Guitar', 24),
  g('steel-guitar', 'Acoustic Guitar (steel)', 25),
  g('jazz-guitar', 'Jazz Guitar', 26),
  g('electric-guitar-clean', 'Electric Guitar (clean)', 27),
  g('electric-guitar-muted', 'Electric Guitar (muted)', 28),
  g('overdrive-guitar', 'Overdrive Guitar', 29),
  g('distortion-guitar', 'Distortion Guitar', 30),
  b('acoustic-bass', 'Acoustic Bass', 32),
  b('fingered-bass', 'Electric Bass (finger)', 33),
  b('picked-bass', 'Electric Bass (pick)', 34),
  b('fretless-bass', 'Fretless Bass', 35),
  b('slap-bass', 'Slap Bass', 36),
  { id: 'synth-bass', name: 'Synth Bass', group: 'Basses', program: 38 },
  { id: 'violin', name: 'Violin', group: 'Strings', program: 40 },
  { id: 'viola', name: 'Viola', group: 'Strings', program: 41 },
  { id: 'cello', name: 'Cello', group: 'Strings', program: 42 },
  { id: 'contrabass', name: 'Contrabass', group: 'Strings', program: 43 },
  { id: 'pizzicato-strings', name: 'Pizzicato Strings', group: 'Strings', program: 45 },
  { id: 'harp', name: 'Harp', group: 'Strings', program: 46 },
  { id: 'string-ensemble', name: 'String Ensemble', group: 'Strings', program: 48 },
  { id: 'trumpet', name: 'Trumpet', group: 'Brass', program: 56 },
  { id: 'trombone', name: 'Trombone', group: 'Brass', program: 57 },
  { id: 'tuba', name: 'Tuba', group: 'Brass', program: 58 },
  { id: 'french-horn', name: 'French Horn', group: 'Brass', program: 60 },
  { id: 'brass-section', name: 'Brass Section', group: 'Brass', program: 61 },
  { id: 'soprano-sax', name: 'Soprano Sax', group: 'Winds', program: 64 },
  { id: 'alto-sax', name: 'Alto Sax', group: 'Winds', program: 65 },
  { id: 'tenor-sax', name: 'Tenor Sax', group: 'Winds', program: 66 },
  { id: 'oboe', name: 'Oboe', group: 'Winds', program: 68 },
  { id: 'clarinet', name: 'Clarinet', group: 'Winds', program: 71 },
  { id: 'flute', name: 'Flute', group: 'Winds', program: 73 },
  { id: 'pan-flute', name: 'Pan Flute', group: 'Winds', program: 75 },
  { id: 'square-lead', name: 'Square Lead', group: 'Synths', program: 80 },
  { id: 'saw-lead', name: 'Saw Lead', group: 'Synths', program: 81 },
  { id: 'choir', name: 'Choir Aahs', group: 'Synths', program: 52 },
  { id: 'warm-pad', name: 'Warm Pad', group: 'Synths', program: 89 },
  { id: 'polysynth', name: 'Polysynth', group: 'Synths', program: 90 },
  { id: 'drum-kit', name: 'Drum Kit', group: 'Drums', program: 0, percussion: true },
];

export const INSTRUMENT_GROUPS: InstrumentGroup[] = [
  'Keys', 'Guitars', 'Basses', 'Strings', 'Brass', 'Winds', 'Synths', 'Drums',
];

export function findInstrument(id: string): CatalogInstrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

/** Best catalog entry for a GM program (exact match, else nearest lower program in the same GM family). */
export function instrumentForProgram(program: number, percussion = false): CatalogInstrument {
  if (percussion) return findInstrument('drum-kit')!;
  const exact = INSTRUMENTS.find((i) => !i.percussion && i.program === program);
  if (exact) return exact;
  const family = Math.floor(program / 8);
  const sameFamily = INSTRUMENTS.filter((i) => !i.percussion && Math.floor(i.program / 8) === family);
  if (sameFamily.length) return sameFamily[0];
  return INSTRUMENTS[0];
}

export function toInstrumentRef(c: CatalogInstrument): Instrument {
  return { id: c.id, program: c.program, percussion: !!c.percussion };
}

/** An imported track keeps its exact GM program even if the catalog picked a near neighbour for the name. */
export function instrumentRefForProgram(program: number, percussion = false): Instrument {
  const c = instrumentForProgram(program, percussion);
  return { id: c.id, program: percussion ? 0 : program, percussion };
}
