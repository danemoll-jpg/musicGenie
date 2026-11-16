// Chord names, chord tones, and chord recognition from notes.
import { trackEvents, type NoteEvent } from './events';
import { barStartTicks, barTicks } from './timing';
import type { ChordSymbol, Song, Track } from './types';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};

export type Quality = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'dim' | 'dim7' | 'm7b5' | 'aug' | 'sus2' | 'sus4' | '5' | '6' | 'm6';

/** Intervals above the root, and the suffix written after the root. */
export const QUALITIES: Record<Quality, { intervals: number[]; suffix: string; label: string }> = {
  maj: { intervals: [0, 4, 7], suffix: '', label: 'major' },
  min: { intervals: [0, 3, 7], suffix: 'm', label: 'minor' },
  '7': { intervals: [0, 4, 7, 10], suffix: '7', label: 'dominant 7' },
  maj7: { intervals: [0, 4, 7, 11], suffix: 'maj7', label: 'major 7' },
  m7: { intervals: [0, 3, 7, 10], suffix: 'm7', label: 'minor 7' },
  dim: { intervals: [0, 3, 6], suffix: 'dim', label: 'diminished' },
  dim7: { intervals: [0, 3, 6, 9], suffix: 'dim7', label: 'diminished 7' },
  m7b5: { intervals: [0, 3, 6, 10], suffix: 'm7b5', label: 'half-diminished' },
  aug: { intervals: [0, 4, 8], suffix: 'aug', label: 'augmented' },
  sus2: { intervals: [0, 2, 7], suffix: 'sus2', label: 'sus2' },
  sus4: { intervals: [0, 5, 7], suffix: 'sus4', label: 'sus4' },
  '5': { intervals: [0, 7], suffix: '5', label: 'power chord' },
  '6': { intervals: [0, 4, 7, 9], suffix: '6', label: 'major 6' },
  m6: { intervals: [0, 3, 7, 9], suffix: 'm6', label: 'minor 6' },
};

/** Templates used for recognition (6ths are left out: they collide with m7 inversions). */
const DETECT: { q: Quality; prior: number }[] = [
  { q: 'maj', prior: 0 }, { q: 'min', prior: 0.01 }, { q: '7', prior: 0.04 }, { q: 'maj7', prior: 0.05 },
  { q: 'm7', prior: 0.05 }, { q: 'dim', prior: 0.05 }, { q: 'dim7', prior: 0.06 }, { q: 'm7b5', prior: 0.07 },
  { q: 'aug', prior: 0.08 }, { q: 'sus2', prior: 0.1 }, { q: 'sus4', prior: 0.1 }, { q: '5', prior: 0.04 },
];

export interface ChordInfo {
  root: number; // pitch class
  quality: Quality;
  bass: number; // pitch class (= root unless a slash chord)
}

const SUFFIX_ALIASES: [RegExp, Quality][] = [
  [/^(maj7|M7|ma7|Δ7?)$/, 'maj7'], [/^(m7b5|ø7?|min7b5|-7b5)$/, 'm7b5'], [/^(dim7|°7|o7)$/, 'dim7'],
  [/^(m7|min7|-7|mi7)$/, 'm7'], [/^(m6|min6|-6)$/, 'm6'], [/^(m|min|-|mi)$/, 'min'], [/^(dim|°|o)$/, 'dim'],
  [/^(aug|\+|#5)$/, 'aug'], [/^(sus2)$/, 'sus2'], [/^(sus4|sus)$/, 'sus4'], [/^(5)$/, '5'], [/^(6)$/, '6'],
  [/^(7|dom7|9|13|11)$/, '7'], [/^(|maj|M|major|add9)$/, 'maj'],
];

/** Parse a chord name like "Am7/G". Unknown suffixes fall back to major/minor by their first letter. */
export function parseChord(name: string): ChordInfo | null {
  const m = /^\s*([A-G][#b]?)([^/]*?)(?:\/([A-G][#b]?))?\s*$/.exec(name);
  if (!m) return null;
  const root = PC[m[1]];
  if (root === undefined) return null;
  const suf = m[2].trim();
  let quality: Quality | undefined;
  for (const [re, q] of SUFFIX_ALIASES) if (re.test(suf)) { quality = q; break; }
  if (!quality) quality = /^(m|min|-)(?!aj)/.test(suf) ? (/7/.test(suf) ? 'm7' : 'min') : /7/.test(suf) ? (/maj/i.test(suf) ? 'maj7' : '7') : 'maj';
  const bass = m[3] !== undefined ? PC[m[3]] ?? root : root;
  return { root, quality, bass };
}

export function chordName(c: ChordInfo, preferFlats = false): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const base = names[c.root] + QUALITIES[c.quality].suffix;
  return c.bass !== c.root ? `${base}/${names[c.bass]}` : base;
}

/** Pitch classes of a chord. */
export function chordTones(c: ChordInfo): number[] {
  return QUALITIES[c.quality].intervals.map((i) => (c.root + i) % 12);
}

/** The triad family a quality belongs to (used to compare chords loosely). */
export function triadOf(q: Quality): 'major' | 'minor' | 'dim' | 'aug' | 'sus' | 'power' {
  switch (q) {
    case 'maj': case '7': case 'maj7': case '6': return 'major';
    case 'min': case 'm7': case 'm6': return 'minor';
    case 'dim': case 'dim7': case 'm7b5': return 'dim';
    case 'aug': return 'aug';
    case 'sus2': case 'sus4': return 'sus';
    case '5': return 'power';
  }
}

/** Same root and same triad family (bass note and 7ths ignored). */
export function sameChord(a: string, b: string): boolean {
  const x = parseChord(a);
  const y = parseChord(b);
  if (!x || !y) return false;
  // A diminished 7th is symmetric: any of its notes can be called the root.
  if (x.quality === 'dim7' || y.quality === 'dim7') {
    const sx = new Set(chordTones(x));
    const ty = chordTones(y);
    return triadOf(x.quality) === 'dim' && triadOf(y.quality) === 'dim' && ty.filter((t) => sx.has(t)).length >= 3;
  }
  return x.root === y.root && triadOf(x.quality) === triadOf(y.quality);
}

// ---------------- recognition ----------------

interface Scored {
  info: ChordInfo;
  score: number;
}

interface Profile {
  /** Normalised pitch-class weights. */
  w: number[];
  total: number;
  /** Bass pitch class, -1 if none. */
  bass: number;
}

/** Weighted pitch-class profile and the bass note of the events overlapping [a, b). */
function profile(events: NoteEvent[], a: number, b: number): Profile {
  const w = new Array<number>(12).fill(0);
  let bassPitch = Infinity;
  const len = b - a;
  for (const e of events) {
    const s = Math.max(a, e.start);
    const t = Math.min(b, e.start + e.dur);
    if (t <= s) continue;
    // Notes struck on a beat count more than passing notes between beats.
    const onBeat = e.start % 480 === 0 ? 1 : 0.6;
    const struck = e.start >= a ? 1 : 0.8;
    w[e.pitch % 12] += (t - s) * onBeat * struck;
    // The bass: lowest note that rings a while or is struck on the window's first beat.
    if ((t - s >= len / 8 || (e.start >= a && e.start < a + 480)) && e.pitch < bassPitch) bassPitch = e.pitch;
  }
  const total = w.reduce((x, y) => x + y, 0);
  return { w: total > 0 ? w.map((x) => x / total) : w, total, bass: bassPitch === Infinity ? -1 : bassPitch % 12 };
}

/** Penalty for a chord tone that is not sounding: root and 3rd matter most, the 5th is often left out. */
function missingCost(interval: number): number {
  if (interval === 0) return 0.15;
  if (interval === 3 || interval === 4) return 0.12;
  if (interval === 6 || interval === 7 || interval === 8) return 0.04;
  return 0.1;
}

/** How well a chord explains a profile (higher = better, about 1 = perfect). */
function fit(root: number, q: Quality, prior: number, p: Profile): number {
  let covered = 0;
  let missing = 0;
  for (const i of QUALITIES[q].intervals) {
    const x = p.w[(root + i) % 12];
    covered += x;
    if (x < 0.03) missing += missingCost(i);
  }
  let score = covered - 0.7 * (1 - covered) - missing - prior;
  if (p.bass === root) score += 0.15;
  return score;
}

/** Best single chord over one or more windows (weighted by how much sounds in each). */
function bestOver(ps: Profile[]): Scored | null {
  const total = ps.reduce((a, p) => a + p.total, 0);
  if (total <= 0) return null;
  let best: Scored | null = null;
  for (let root = 0; root < 12; root++) {
    for (const { q, prior } of DETECT) {
      let score = 0;
      for (const p of ps) if (p.total > 0) score += (fit(root, q, prior, p) * p.total) / total;
      if (!best || score > best.score + 1e-9) best = { info: { root, quality: q, bass: root }, score };
    }
  }
  return best;
}

/** Diatonic triad quality for a root in a major key (fifths = key signature). */
function diatonicQuality(root: number, keyFifths: number): Quality {
  const tonic = (((keyFifths * 7) % 12) + 12) % 12;
  const deg = (root - tonic + 12) % 12;
  if (deg === 2 || deg === 4 || deg === 9) return 'min';
  if (deg === 11) return 'dim';
  return 'maj';
}

export interface DetectOptions {
  /** Tracks to listen to. Default: every pitched track the band did not make. */
  trackIds?: string[];
  /**
   * Name a bare root + 5th as a power chord ("G5"). Default: only when the source is guitar;
   * otherwise the missing 3rd is taken from the key (G in C major, Dm in C major...).
   */
  powerChords?: boolean;
}

/** Tracks used as the harmony source: pitched, not generated, and not split parts of a track still present. */
export function harmonySourceTracks(song: Song): Track[] {
  const ids = new Set(song.tracks.map((t) => t.id));
  return song.tracks.filter(
    (t) => !t.instrument.percussion && !t.generated && !(t.derived && ids.has(t.derived.from)),
  );
}

const CHANGE_COST = 0.15;

/**
 * Work out chord symbols from the notes: one per bar, or per half bar / per beat when the
 * harmony clearly moves faster. A split is taken only when one chord per window explains the
 * notes better than the best single chord over the same windows, by more than a cost per change.
 * Weighting: note length, struck on the beat vs. passing, and a bonus when the bass is the root.
 */
export function detectChords(song: Song, opts: DetectOptions = {}): ChordSymbol[] {
  const tracks = opts.trackIds
    ? song.tracks.filter((t) => opts.trackIds!.includes(t.id))
    : harmonySourceTracks(song);
  const power = opts.powerChords ?? tracks.some((t) => !!t.tuning && t.instrument.program >= 24 && t.instrument.program <= 31);
  const events = tracks.flatMap((t) => trackEvents(song, t));
  const starts = barStartTicks(song);
  const out: ChordSymbol[] = [];
  let last = '';
  song.bars.forEach((bar, bi) => {
    const bs = starts[bi];
    const len = barTicks(bar);
    const wholeP = profile(events, bs, bs + len);
    const whole = bestOver([wholeP]);
    if (!whole) return;
    const beatLen = (960 * 4) / bar.timeSignature.denominator;
    const beats = Math.round(len / beatLen);
    const grids: number[][] = [];
    if (beats >= 4 && beats % 2 === 0) grids.push([0, (beats / 2) * beatLen]);
    if (beats >= 2) grids.push(Array.from({ length: beats }, (_, i) => i * beatLen));

    let pick: { tick: number; c: ChordInfo; p: Profile }[] = [{ tick: 0, c: whole.info, p: wholeP }];
    let gain = 0;
    for (const cuts of grids) {
      const ps = cuts.map((a, i) => profile(events, bs + a, bs + (i + 1 < cuts.length ? cuts[i + 1] : len)));
      const single = bestOver(ps);
      if (!single) continue;
      const total = ps.reduce((a, p) => a + p.total, 0);
      let splitScore = 0;
      const segs: { tick: number; c: ChordInfo; p: Profile }[] = [];
      ps.forEach((p, i) => {
        const c = bestOver([p]);
        if (!c) return;
        splitScore += (c.score * p.total) / total;
        const prev = segs[segs.length - 1];
        // Same root again = the same chord with passing notes, not a change.
        if (prev && prev.c.root === c.info.root) return;
        segs.push({ tick: cuts[i], c: c.info, p });
      });
      if (segs.length < 2) continue;
      const g = splitScore - CHANGE_COST * (segs.length - 1) - single.score - (cuts.length > 2 ? 0.05 : 0);
      if (g > gain) {
        gain = g;
        pick = segs;
      }
    }
    const fifths = song.bars[bi]?.key.fifths ?? 0;
    pick.forEach((seg, i) => {
      const c: ChordInfo = { ...seg.c };
      if (c.quality === '5' && !power) c.quality = diatonicQuality(c.root, fifths);
      // Slash chord when the bass is another note.
      c.bass = seg.p.bass >= 0 ? seg.p.bass : c.root;
      const name = chordName(c, fifths < 0);
      if (i > 0 && name === last) return;
      out.push({ bar: bi, tick: seg.tick, name, source: 'detected' });
      last = name;
    });
  });
  return out;
}


/**
 * Apply recognised chords to the song. Chords that came with the file (or were set by hand)
 * are kept unless `replace` is true.
 */
export function applyDetectedChords(song: Song, detected: ChordSymbol[], replace = false): Song {
  const next = structuredClone(song);
  const keep = next.chordSymbols.filter((c) => c.source !== 'detected');
  if (replace || keep.length === 0) {
    next.chordSymbols = detected;
  } else {
    // Fill only bars that have no chord of their own.
    const barsWithChords = new Set(keep.map((c) => c.bar));
    next.chordSymbols = [...keep, ...detected.filter((c) => !barsWithChords.has(c.bar))];
  }
  next.chordSymbols.sort((a, b) => a.bar - b.bar || a.tick - b.tick);
  return next;
}

/** Set (or with name = null remove) the chord at a bar position by hand. */
export function setChordSymbol(song: Song, bar: number, tick: number, name: string | null): Song {
  const next = structuredClone(song);
  next.chordSymbols = next.chordSymbols.filter((c) => !(c.bar === bar && c.tick === tick));
  if (name) next.chordSymbols.push({ bar, tick, name, source: 'user' });
  next.chordSymbols.sort((a, b) => a.bar - b.bar || a.tick - b.tick);
  return next;
}

/** Chord sounding at (bar, tick): the last symbol at or before it. */
export function chordAt(chords: ChordSymbol[], bar: number, tick: number): ChordSymbol | undefined {
  let found: ChordSymbol | undefined;
  for (const c of chords) {
    if (c.bar < bar || (c.bar === bar && c.tick <= tick)) found = c;
    else break;
  }
  return found;
}
