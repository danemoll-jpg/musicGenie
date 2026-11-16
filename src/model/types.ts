// musicGenie music model: the single source of truth.
// Pure data, no Electron/DOM imports. Everything here must survive JSON.stringify/parse unchanged.

/** Ticks per quarter note used everywhere in the model. */
export const PPQ = 960;

export interface Song {
  title: string;
  artist: string;
  album: string;
  composer: string;
  /** Song-level measure headers. Every staff has exactly bars.length measures. */
  bars: BarHeader[];
  /** Tempo map. Sorted by (bar, tick). The first entry is at bar 0, tick 0. */
  tempos: TempoChange[];
  /** Named sections (intro / verse / chorus ...), each starting at a bar. */
  sections: Section[];
  /** Chord symbols placed in time (shown above the first visible track). */
  chordSymbols: ChordSymbol[];
  tracks: Track[];
  /** Playback feel and sound (schema v2+). Missing = straight, default SoundFont. */
  playback?: Playback;
  /** Last band-panel setup used on this song (schema v2+). */
  band?: BandSettings;
}

export interface Playback {
  /** 0 = straight eighths, 1 = full triplet swing (2:1). Applied at playback only; notation stays straight. */
  swing: number;
  /** Path of a user SoundFont (.sf2/.sf3). Missing = the bundled default. */
  soundFont?: string;
}

export type StyleId = 'rock' | 'blues' | 'country' | 'jazz' | 'pop';
export type BandRole = 'drums' | 'bass' | 'rhythm' | 'lead';
export type Complexity = 'simple' | 'normal' | 'busy';

export interface PlayerSetup {
  role: BandRole;
  on: boolean;
  instrumentId: string;
  complexity: Complexity;
  /** Lead only: octaves added on top of the automatic range fit (-2..2). */
  octave?: number;
}

export interface BandSettings {
  style: StyleId;
  players: PlayerSetup[];
  bassFollowsKick: boolean;
  /** Hold the final chord in the last bar. */
  ending: boolean;
  seed: number;
  /** Track the band plays along to (melody + harmony source). */
  sourceTrackId?: string;
}

/** Marks a track the band engine made. Same inputs + seed = same notes. */
export interface GeneratedTag {
  style: StyleId;
  role: BandRole;
  complexity: Complexity;
  seed: number;
  /** Per-section seed overrides from "Regenerate section" (key = section start bar). */
  sectionSeeds?: Record<string, number>;
  sourceTrackId?: string;
  bassFollowsKick?: boolean;
  ending?: boolean;
  octave?: number;
  /** Hash of the staves as generated. Different now = edited by hand. */
  contentHash: string;
}

export interface BarHeader {
  timeSignature: { numerator: number; denominator: number };
  /** Key: -7 (7 flats) .. +7 (7 sharps). A key change is a bar whose key differs from the previous bar. */
  key: { fifths: number; mode: 'major' | 'minor' };
  repeatStart?: boolean;
  /** Number of times to play when this bar ends a repeat (0 = no repeat end). */
  repeatEnd?: number;
}

export interface TempoChange {
  bar: number;
  /** Offset within the bar, in model ticks (PPQ). */
  tick: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface Section {
  bar: number;
  name: string;
}

export interface ChordSymbol {
  bar: number;
  tick: number;
  name: string;
  /** Where it came from. Missing = came with the file. */
  source?: 'file' | 'detected' | 'user';
}

export interface Instrument {
  /** Catalog id (see instruments.ts), e.g. "acoustic-grand-piano". */
  id: string;
  /** General MIDI program 0-127 (ignored for drums). */
  program: number;
  percussion: boolean;
}

export type DisplayMode = 'notation' | 'tab' | 'both';

export interface Track {
  id: string;
  name: string;
  /** What plays the notes. Changing it never touches the notes. */
  instrument: Instrument;
  /**
   * Open-string pitches (MIDI numbers) for fretted instruments, LOWEST string first.
   * String numbers on notes are 1-based with 1 = the lowest string (alphaTab's convention;
   * Rocksmith's 0-based string index is string - 1).
   */
  tuning?: number[];
  capo?: number;
  /** Semitones the notation is shifted for display (e.g. guitar is written an octave up: +12 shown as -12 pitch shift). */
  displayTranspose?: number;
  mixer: Mixer;
  display: TrackDisplay;
  staves: Staff[];
  /** Set on band-engine tracks. */
  generated?: GeneratedTag;
  /** Set on tracks made by "Split into band parts". */
  derived?: { from: string; part: SplitPart };
}

export type SplitPart = 'melody' | 'harmony' | 'bass';

export interface Mixer {
  /** 0..1 */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
}

export interface TrackDisplay {
  visible: boolean;
  mode: DisplayMode;
}

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'neutral';

export interface Staff {
  clef: Clef;
  measures: Measure[];
}

export interface Measure {
  voices: Voice[];
}

export interface Voice {
  beats: Beat[];
}

export type DurationBase = 1 | 2 | 4 | 8 | 16 | 32 | 64;

export interface Duration {
  /** 1 = whole, 2 = half, 4 = quarter ... 64 = sixty-fourth. */
  base: DurationBase;
  dots: 0 | 1 | 2;
  /** e.g. triplet = { num: 3, den: 2 } (3 in the time of 2). */
  tuplet?: { num: number; den: number };
}

/** A rhythmic event in a voice: a rest (no notes) or a note/chord. */
export interface Beat {
  duration: Duration;
  notes: Note[];
  grace?: boolean;
  lyric?: string;
  text?: string;
}

export interface Note {
  /** Sounding pitch as a MIDI number (60 = middle C). */
  pitch: number;
  /** 1..127 */
  velocity: number;
  /** 1-based, 1 = lowest string. Optional: only meaningful on fretted tracks. */
  string?: number;
  fret?: number;
  /** This note continues (is tied from) the same pitch in the previous beat. */
  tieFromPrevious?: boolean;
  techniques?: Techniques;
}

export interface BendPoint {
  /** 0..60 across the note's length (alphaTab/Guitar Pro scale). */
  position: number;
  /** Quarter tones (2 = half step, 4 = whole step). */
  value: number;
}

export interface Techniques {
  /** This note is sounded by hammering on from the previous note on the same string. */
  hammerOn?: boolean;
  /** This note is sounded by pulling off from the previous note on the same string. */
  pullOff?: boolean;
  slideIn?: 'fromBelow' | 'fromAbove';
  /** shift / legato slide to the next note, or a slide out up/down. */
  slideOut?: 'shift' | 'legato' | 'outUp' | 'outDown';
  bend?: BendPoint[];
  vibrato?: 'slight' | 'wide';
  palmMute?: boolean;
  harmonic?: 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi';
  tap?: boolean;
  slap?: boolean;
  pop?: boolean;
  accent?: 'normal' | 'heavy';
  letRing?: boolean;
  dead?: boolean;
  ghost?: boolean;
  staccato?: boolean;
}
