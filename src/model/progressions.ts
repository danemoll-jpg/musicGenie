// Chord progression helper: the song's key, diatonic chords, "what could come next",
// substitutions, and a library of common progressions written in Roman numerals.
import { FLAT_NAMES, SHARP_NAMES } from './chords';
import { parseChordSpec, specName, type ChordSpec } from './chordTheory';
import { barTicks } from './timing';
import type { ChordSymbol, Song } from './types';

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export interface Key {
  tonic: number; // pitch class
  mode: 'major' | 'minor';
}

export function keyOfBar(song: Song, bar: number): Key {
  const k = song.bars[bar]?.key ?? { fifths: 0, mode: 'major' as const };
  const major = mod12(k.fifths * 7);
  return k.mode === 'minor' ? { tonic: mod12(major + 9), mode: 'minor' } : { tonic: major, mode: 'major' };
}

/** Key signature (fifths) of a key. */
export function keyFifths(k: Key): number {
  const major = k.mode === 'minor' ? mod12(k.tonic + 3) : k.tonic;
  let f = mod12(major * 7);
  if (f > 6) f -= 12;
  // F# major (6) is written as Gb (-6) less often; keep sharps up to 6.
  return f;
}

export function keyName(k: Key): string {
  const flats = keyFifths(k) < 0;
  return (flats ? FLAT_NAMES : SHARP_NAMES)[k.tonic] + (k.mode === 'minor' ? ' minor' : ' major');
}

export function preferFlats(k: Key): boolean {
  return keyFifths(k) < 0;
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function scalePcs(k: Key): number[] {
  return (k.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map((i) => mod12(k.tonic + i));
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * Roman numeral -> chord name in a key. Degrees count from the tonic on the MAJOR scale, so in
 * minor keys write the flats: "i", "bIII", "iv", "V7", "bVI", "bVII". Upper case = major,
 * lower = minor; suffixes: ° (dim), ø7 (m7b5), + (aug), 7, maj7, 9, sus4, 6 ... "V/V" = secondary.
 */
export function romanToChord(roman: string, k: Key): string {
  const sec = roman.split('/');
  if (sec.length === 2 && /^[b#]?[iIvV]+/.test(sec[1])) {
    // Secondary chord: V/x = the V of the chord on x.
    const target = romanRoot(sec[1], k.tonic);
    return romanToChord(sec[0], { tonic: target, mode: 'major' });
  }
  const m = /^([b#]?)([iIvV]+)(.*)$/.exec(roman.trim());
  if (!m) return roman;
  const idx = NUMERALS.indexOf(m[2].toUpperCase());
  if (idx < 0) return roman;
  let root = mod12(k.tonic + MAJOR_SCALE[idx] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0));
  const lower = m[2] === m[2].toLowerCase();
  let suf = m[3];
  let name: string;
  if (suf.startsWith('°7') || suf.startsWith('o7')) name = 'dim7' + suf.slice(2);
  else if (suf.startsWith('°') || suf.startsWith('o')) name = 'dim' + suf.slice(1);
  else if (suf.startsWith('ø')) name = 'm7b5' + suf.replace(/^ø7?/, '');
  else if (suf.startsWith('+')) name = 'aug' + suf.slice(1);
  else name = (lower ? 'm' : '') + suf;
  root = mod12(root);
  const flats = preferFlats(k) || (m[1] === 'b' && k.mode === 'major');
  return (flats ? FLAT_NAMES : SHARP_NAMES)[root] + name;
}

function romanRoot(roman: string, tonic: number): number {
  const m = /^([b#]?)([iIvV]+)/.exec(roman.trim());
  if (!m) return tonic;
  const idx = NUMERALS.indexOf(m[2].toUpperCase());
  return mod12(tonic + MAJOR_SCALE[Math.max(0, idx)] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0));
}

/** The seven diatonic chords (triads or 7ths) as Roman numerals. Minor keys use the harmonic-minor V. */
export function diatonicNumerals(mode: 'major' | 'minor', sevenths = false): string[] {
  if (mode === 'major') return sevenths ? ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  return sevenths ? ['i7', 'iiø7', 'bIIImaj7', 'iv7', 'V7', 'bVImaj7', 'bVII7'] : ['i', 'ii°', 'bIII', 'iv', 'V', 'bVI', 'bVII'];
}

export function diatonicChords(k: Key, sevenths = false): { roman: string; name: string }[] {
  return diatonicNumerals(k.mode, sevenths).map((r) => ({ roman: r, name: romanToChord(r, k) }));
}

/** Roman numeral of a chord in a key (diatonic or the closest description), e.g. "V7", "bVII". */
export function chordRoman(name: string, k: Key): string {
  const c = parseChordSpec(name);
  if (!c) return '?';
  const iv = mod12(c.root - k.tonic);
  const table: Record<number, string> = { 0: 'I', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV', 6: '#IV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };
  let r = table[iv];
  const minorish = c.triad === 'min' || c.triad === 'dim';
  if (minorish) r = r.replace(/[IV]+/, (x) => x.toLowerCase());
  const suf = specName({ ...c, root: 0, bass: 0 }).slice(1).replace(/^m(?!aj)/, '').replace(/^dim/, '°');
  return r + suf;
}

export interface Suggestion {
  name: string;
  roman: string;
  why: string;
  kind: 'next' | 'substitute' | 'secondary' | 'tritone' | 'borrowed' | 'relative';
}

// Common next chords by scale degree (0-based), for major and minor keys.
const NEXT_MAJOR: Record<number, number[]> = { 0: [3, 4, 5, 1, 2], 1: [4, 6, 3], 2: [5, 3], 3: [4, 0, 1, 6], 4: [0, 5, 3], 5: [1, 3, 4, 2], 6: [0, 2] };
const NEXT_MINOR: Record<number, number[]> = { 0: [3, 4, 5, 6, 1], 1: [4], 2: [5, 3], 3: [4, 0, 6], 4: [0, 5], 5: [3, 1, 6, 4], 6: [2, 0] };
const WHY_NEXT: Record<string, string> = {
  '0>3': 'tonic to subdominant', '0>4': 'tonic to dominant', '0>5': 'tonic to its relative', '3>4': 'subdominant to dominant',
  '4>0': 'dominant resolves home', '4>5': 'deceptive cadence', '1>4': 'ii-V motion', '5>1': 'down a fifth toward V',
  '5>3': 'common pop move', '3>0': 'plagal (amen) cadence', '6>0': 'leading-tone chord resolves home',
};

/** Degree (0-6) of a chord root in the key, or -1 if not diatonic. */
function degreeOf(root: number, k: Key): number {
  return scalePcs(k).indexOf(mod12(root));
}

/** What could follow `current` (a chord name; null = start of the song) in key k. */
export function suggestNext(current: string | null, k: Key): Suggestion[] {
  const out: Suggestion[] = [];
  const dia = diatonicChords(k);
  const add = (s: Suggestion) => {
    if (!out.some((x) => x.name === s.name)) out.push(s);
  };
  const c = current ? parseChordSpec(current) : null;
  const deg = c ? degreeOf(c.root, k) : -1;
  if (!c) {
    add({ name: dia[0].name, roman: dia[0].roman, why: 'start on the tonic', kind: 'next' });
  } else if (deg >= 0) {
    const table = k.mode === 'major' ? NEXT_MAJOR : NEXT_MINOR;
    for (const d of table[deg] ?? []) add({ name: dia[d].name, roman: dia[d].roman, why: WHY_NEXT[`${deg}>${d}`] ?? 'diatonic move', kind: 'next' });
  } else {
    add({ name: dia[0].name, roman: dia[0].roman, why: 'back to the tonic', kind: 'next' });
    add({ name: dia[4].name, roman: dia[4].roman, why: 'to the dominant', kind: 'next' });
  }
  // Secondary dominants: V7 of the diatonic targets (ii, iii, IV, V, vi in major).
  const targets = k.mode === 'major' ? [1, 2, 3, 4, 5] : [2, 3, 5, 6];
  for (const t of targets) {
    const tr = mod12(scalePcs(k)[t] + 7);
    const name = noteName(tr, k) + '7';
    add({ name, roman: `V7/${dia[t].roman}`, why: `secondary dominant: leads to ${dia[t].name}`, kind: 'secondary' });
  }
  // Borrowed from the parallel key.
  const borrowed = k.mode === 'major' ? ['iv', 'bVI', 'bVII', 'bIII', 'ii°'] : ['IV', 'I', 'bII'];
  for (const r of borrowed) {
    const name = romanToChord(r, k);
    add({ name, roman: r, why: `borrowed from ${noteName(k.tonic, k)} ${k.mode === 'major' ? 'minor' : 'major'}`, kind: 'borrowed' });
  }
  return out;
}

/** Substitutes for a chord: relative minor/major, tritone sub (dominants), diatonic 3rd-related chords. */
export function substitutions(chord: string, k: Key): Suggestion[] {
  const c = parseChordSpec(chord);
  if (!c) return [];
  const out: Suggestion[] = [];
  const minor = c.triad === 'min';
  const isDom = c.triad === 'maj' && (c.ext === '7' || c.ext === '9' || c.ext === '13');
  if (c.triad === 'maj') {
    const r = mod12(c.root + 9);
    out.push({ name: noteName(r, k) + 'm', roman: chordRoman(noteName(r, k) + 'm', k), why: 'relative minor (shares two notes)', kind: 'relative' });
    const iii = mod12(c.root + 4);
    out.push({ name: noteName(iii, k) + 'm', roman: chordRoman(noteName(iii, k) + 'm', k), why: 'mediant (shares two notes)', kind: 'substitute' });
  }
  if (minor) {
    const r = mod12(c.root + 3);
    out.push({ name: noteName(r, k), roman: chordRoman(noteName(r, k), k), why: 'relative major (shares two notes)', kind: 'relative' });
  }
  if (isDom || (c.triad === 'maj' && degreeOf(c.root, k) === 4)) {
    const t = mod12(c.root + 6);
    out.push({ name: noteName(t, k, true) + '7', roman: chordRoman(noteName(t, k, true) + '7', k), why: 'tritone substitution (same 3rd and 7th)', kind: 'tritone' });
    out.push({ name: noteName(mod12(c.root + 4), k) + 'dim7', roman: 'vii°7', why: 'diminished 7th on the 3rd (rootless dominant b9)', kind: 'substitute' });
  }
  // The dominant that leads into this chord.
  const v = mod12(c.root + 7);
  out.push({ name: noteName(v, k) + '7', roman: `V7/${chordRoman(chord, k)}`, why: `secondary dominant: put it before ${chord}`, kind: 'secondary' });
  // Parallel version (major <-> minor).
  out.push({ name: noteName(c.root, k) + (minor ? '' : 'm'), roman: chordRoman(noteName(c.root, k) + (minor ? '' : 'm'), k), why: `parallel ${minor ? 'major' : 'minor'} (borrowed)`, kind: 'borrowed' });
  return out;
}

function noteName(pc: number, k: Key, flat = false): string {
  return (flat || preferFlats(k) ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export interface Progression {
  id: string;
  name: string;
  mode: 'major' | 'minor';
  /** One entry per bar; a bar with two chords is written "IV V". */
  bars: string[];
}

export const PROGRESSIONS: Progression[] = [
  { id: 'pop', name: 'I-V-vi-IV (pop)', mode: 'major', bars: ['I', 'V', 'vi', 'IV'] },
  { id: 'fifties', name: '50s (I-vi-IV-V)', mode: 'major', bars: ['I', 'vi', 'IV', 'V'] },
  { id: 'iiVI', name: 'ii-V-I (jazz)', mode: 'major', bars: ['ii7', 'V7', 'Imaj7', 'Imaj7'] },
  { id: 'blues12', name: '12-bar blues', mode: 'major', bars: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] },
  { id: 'quickchange', name: '12-bar blues (quick change)', mode: 'major', bars: ['I7', 'IV7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'] },
  { id: 'threechord', name: 'I-IV-V-I', mode: 'major', bars: ['I', 'IV', 'V', 'I'] },
  { id: 'sadpop', name: 'vi-IV-I-V', mode: 'major', bars: ['vi', 'IV', 'I', 'V'] },
  { id: 'turnaround', name: 'I-vi-ii-V turnaround', mode: 'major', bars: ['I', 'vi', 'ii', 'V'] },
  { id: 'canon', name: 'Canon (Pachelbel)', mode: 'major', bars: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
  { id: 'mixo', name: 'Rock I-bVII-IV', mode: 'major', bars: ['I', 'bVII', 'IV', 'I'] },
  { id: 'royal', name: 'Royal road (IV-V-iii-vi)', mode: 'major', bars: ['IVmaj7', 'V7', 'iii7', 'vi'] },
  { id: 'andalusian', name: 'Andalusian cadence', mode: 'minor', bars: ['i', 'bVII', 'bVI', 'V'] },
  { id: 'minoriiVi', name: 'Minor ii-V-i', mode: 'minor', bars: ['iiø7', 'V7', 'i', 'i'] },
  { id: 'minorpop', name: 'i-bVI-bIII-bVII (minor pop)', mode: 'minor', bars: ['i', 'bVI', 'bIII', 'bVII'] },
  { id: 'minorblues', name: 'Minor blues', mode: 'minor', bars: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'bVI7', 'V7', 'i7', 'V7'] },
];

/**
 * A progression's chords in a key. A major progression in a minor-key song uses the relative
 * major (and the reverse), so it stays in the song's key signature.
 */
export function progressionChords(p: Progression, k: Key): string[][] {
  let key = k;
  if (p.mode !== k.mode) key = p.mode === 'major' ? { tonic: mod12(k.tonic + 3), mode: 'major' } : { tonic: mod12(k.tonic + 9), mode: 'minor' };
  return p.bars.map((b) => b.split(/\s+/).filter(Boolean).map((r) => romanToChord(r, key)));
}

/**
 * Write chords over bars [fromBar, toBar] (inclusive), one entry per bar, repeating the list
 * if the range is longer. Two chords in a bar split it in half (by beats). Existing chord
 * symbols in those bars are replaced.
 */
export function insertChordBars(song: Song, fromBar: number, toBar: number, bars: string[][]): Song {
  const next = structuredClone(song);
  if (!bars.length) return song;
  const last = Math.min(toBar, next.bars.length - 1);
  next.chordSymbols = next.chordSymbols.filter((c) => c.bar < fromBar || c.bar > last);
  for (let b = fromBar; b <= last; b++) {
    const chords = bars[(b - fromBar) % bars.length];
    next.chordSymbols.push(...splitBarChords(next, b, chords));
  }
  next.chordSymbols.sort((a, b) => a.bar - b.bar || a.tick - b.tick);
  return next;
}

/** Chord symbols for n chords evenly spread over a bar (on beats). */
export function splitBarChords(song: Song, bar: number, chords: string[]): ChordSymbol[] {
  const len = barTicks(song.bars[bar]);
  const beat = (960 * 4) / song.bars[bar].timeSignature.denominator;
  const beats = Math.max(1, Math.round(len / beat));
  return chords.map((name, i) => ({
    bar, tick: Math.min(len - 1, Math.round((i * beats) / chords.length) * beat), name, source: 'user' as const,
  }));
}

/** Chord name at or before (bar, tick). */
export function chordBefore(song: Song, bar: number): string | null {
  let found: string | null = null;
  for (const c of song.chordSymbols) {
    if (c.bar <= bar) found = c.name;
    else break;
  }
  return found;
}

export type { ChordSpec };
