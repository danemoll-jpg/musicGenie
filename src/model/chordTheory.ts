// Chord explorer theory: full chord names (extensions, alterations, slash bass) -> notes, and
// every practical way to play them: guitar shapes (open, barre, other movable shapes, power
// chords, triads on string sets), bass shapes, piano voicings (close + inversions, open, drop 2).
// Pure; respects any tuning (lowest string first) and a capo (frets count from the nut).
import { FLAT_NAMES, SHARP_NAMES } from './chords';

const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0,
};
const mod12 = (n: number) => ((n % 12) + 12) % 12;

export type Triad = 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '5';
export type Extension = '' | '6' | '7' | 'maj7' | '9' | 'maj9' | 'add9' | '6/9' | '11' | 'add11' | '13' | 'maj13';
export type Alteration = 'b5' | '#5' | 'b9' | '#9' | '#11' | 'b13';

export const TRIADS: { id: Triad; label: string; suffix: string }[] = [
  { id: 'maj', label: 'major', suffix: '' }, { id: 'min', label: 'minor', suffix: 'm' },
  { id: 'dim', label: 'diminished', suffix: 'dim' }, { id: 'aug', label: 'augmented', suffix: 'aug' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2' }, { id: 'sus4', label: 'sus4', suffix: 'sus4' },
  { id: '5', label: 'power (5)', suffix: '5' },
];
export const EXTENSIONS: { id: Extension; label: string }[] = [
  { id: '', label: 'none' }, { id: '6', label: '6' }, { id: '7', label: '7' }, { id: 'maj7', label: 'maj7' },
  { id: '9', label: '9' }, { id: 'maj9', label: 'maj9' }, { id: 'add9', label: 'add9' }, { id: '6/9', label: '6/9' },
  { id: '11', label: '11' }, { id: 'add11', label: 'add11' }, { id: '13', label: '13' }, { id: 'maj13', label: 'maj13' },
];
export const ALTERATIONS: Alteration[] = ['b5', '#5', 'b9', '#9', '#11', 'b13'];

export interface ChordSpec {
  root: number;
  triad: Triad;
  ext: Extension;
  alt: Alteration[];
  /** Pitch class of the lowest note (= root unless a slash chord). */
  bass: number;
}

export interface ChordNotes {
  /** Intervals above the root (semitones; 9ths etc. above 12). */
  intervals: number[];
  /** Pitch classes that must sound. */
  required: number[];
  /** Pitch classes that may sound. */
  all: number[];
}

/** Intervals of a chord, which ones can be left out (5th, 9th of an 11/13...). */
export function chordNotes(c: ChordSpec): ChordNotes {
  const iv = new Map<number, boolean>(); // interval -> required
  const third = c.triad === 'min' || c.triad === 'dim' ? 3 : c.triad === 'sus2' ? 2 : c.triad === 'sus4' ? 5 : c.triad === '5' ? -1 : 4;
  const fifth = c.triad === 'dim' ? 6 : c.triad === 'aug' ? 8 : 7;
  iv.set(0, true);
  if (third >= 0) iv.set(third, true);
  iv.set(fifth, true);
  const seventh = c.triad === 'dim' ? 9 : 10; // dim + "7" = diminished 7th
  switch (c.ext) {
    case '6': iv.set(9, true); break;
    case '7': iv.set(seventh, true); break;
    case 'maj7': iv.set(11, true); break;
    case '9': iv.set(seventh, true); iv.set(14, true); break;
    case 'maj9': iv.set(11, true); iv.set(14, true); break;
    case 'add9': iv.set(14, true); break;
    case '6/9': iv.set(9, true); iv.set(14, true); break;
    case '11': iv.set(seventh, true); iv.set(14, false); iv.set(17, true); if (third === 4) iv.set(4, false); break;
    case 'add11': iv.set(17, true); break;
    case '13': iv.set(seventh, true); iv.set(14, false); iv.set(21, true); if (third === 3) iv.set(17, false); break;
    case 'maj13': iv.set(11, true); iv.set(14, false); iv.set(21, true); break;
  }
  for (const a of c.alt) {
    if (a === 'b5') { iv.delete(fifth); iv.set(6, true); }
    if (a === '#5') { iv.delete(fifth); iv.set(8, true); }
    if (a === 'b9') { iv.delete(14); iv.set(13, true); }
    if (a === '#9') { iv.delete(14); iv.set(15, true); }
    if (a === '#11') { iv.delete(17); iv.set(18, true); }
    if (a === 'b13') { iv.delete(21); iv.set(20, true); }
  }
  // With 4+ notes the (unaltered) perfect 5th may be left out.
  if (iv.size >= 4 && iv.has(7) && c.triad !== '5') iv.set(7, false);
  const intervals = [...iv.keys()].sort((a, b) => a - b);
  const required = new Set<number>();
  const all = new Set<number>();
  for (const [i, req] of iv) {
    all.add(mod12(c.root + i));
    if (req) required.add(mod12(c.root + i));
  }
  all.add(c.bass);
  required.add(c.bass);
  return { intervals, required: [...required], all: [...all] };
}

/** Write a chord name, e.g. "E7#9", "D/F#", "Am7", "Cmaj9". */
export function specName(c: ChordSpec, preferFlats = false): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  let s = names[c.root];
  const t = c.triad;
  const alt = [...c.alt];
  if (t === 'min' && c.ext === 'maj7') s += 'mMaj7';
  else if (t === 'dim' && c.ext === '7') s += 'dim7';
  else if (t === 'min' && c.ext === '7' && alt.includes('b5')) { s += 'm7b5'; alt.splice(alt.indexOf('b5'), 1); }
  else if (t === 'aug' && c.ext === '7') s += '7#5';
  else {
    const triadSuffix = t === 'maj' ? '' : t === 'min' ? 'm' : t === 'dim' ? 'dim' : t === 'aug' ? 'aug' : t === '5' ? '5' : '';
    s += triadSuffix + c.ext;
    if (t === 'sus2' || t === 'sus4') s += t;
  }
  s += alt.join('');
  if (c.bass !== c.root) s += '/' + names[c.bass];
  return s;
}

/** Parse a chord name: "C", "Am7", "D/F#", "E7#9", "Bbmaj9", "F#m7b5", "Gsus4", "C6/9", "A5". */
export function parseChordSpec(name: string): ChordSpec | null {
  const m = /^\s*([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?\s*$/.exec(name.replace(/♯/g, '#').replace(/♭/g, 'b'));
  if (!m) return null;
  const root = PC[m[1]];
  if (root === undefined) return null;
  let rest = m[2].replace(/[()\s,]/g, '');
  const bass = m[3] !== undefined ? PC[m[3]] ?? root : root;
  let triad: Triad = 'maj';
  let ext: Extension = '';
  const alt: Alteration[] = [];
  const take = (re: RegExp) => {
    const x = re.exec(rest);
    if (!x) return null;
    rest = rest.slice(0, x.index) + rest.slice(x.index + x[0].length);
    return x;
  };
  if (take(/^(m7b5|ø7?|min7b5|-7b5)/)) { triad = 'min'; ext = '7'; alt.push('b5'); }
  else if (take(/^(dim7|°7|o7)/)) { triad = 'dim'; ext = '7'; }
  else if (take(/^(mMaj7|m\(maj7\)|mmaj7|minmaj7|mM7|-maj7)/)) { triad = 'min'; ext = 'maj7'; }
  else if (take(/^(min|mi|m(?!aj)|-)/)) triad = 'min';
  else if (take(/^(dim|°|o)/)) triad = 'dim';
  else if (take(/^(aug|\+)/)) triad = 'aug';
  else if (/^5$/.test(rest)) { triad = '5'; rest = ''; }
  const extM = take(/^(maj13|maj9|maj7|M13|M9|M7|ma7|Δ7?|6\/9|69|add11|add9|add2|13|11|9|7|6)/);
  if (extM) {
    const e = extM[0];
    ext = (/^(M13|maj13)$/.test(e) ? 'maj13' : /^(M9|maj9)$/.test(e) ? 'maj9' : /^(M7|ma7|maj7|Δ7?)$/.test(e) ? 'maj7'
      : e === '69' || e === '6/9' ? '6/9' : e === 'add2' ? 'add9' : e) as Extension;
  }
  if (take(/sus2/)) triad = 'sus2';
  else if (take(/sus4|sus/)) triad = 'sus4';
  for (;;) {
    const a = take(/(b5|#5|b9|#9|#11|b13|-5|\+5|-9|\+9|\+11|-13)/);
    if (!a) break;
    const v = a[0].replace('-', 'b').replace('+', '#') as Alteration;
    if (!alt.includes(v)) alt.push(v);
  }
  if (take(/^aug|^\+/)) triad = 'aug';
  return { root, triad, ext, alt, bass };
}

// ---------------- guitar / bass ----------------

export type VoicingKind = 'open' | 'barre' | 'shape' | 'power' | 'triad' | 'bass' | 'close' | 'inversion' | 'openPiano' | 'drop2';

export interface FretVoicing {
  kind: VoicingKind;
  label: string;
  /** Per string, lowest string first: fret from the nut, or null = not played. */
  frets: (number | null)[];
  /** Finger per string (1 = index .. 4 = pinky, 0 = open/capo, null = not played). */
  fingers: (number | null)[];
  barre?: { fret: number; fromString: number; toString: number };
  /** Sounding pitches, lowest first. */
  pitches: number[];
}

export interface PianoVoicing {
  kind: VoicingKind;
  label: string;
  pitches: number[];
}

/** Assign fingers: a barre on the lowest fret when it covers 2+ strings, then 1-4 by fret/string order. */
function fingering(frets: (number | null)[], capo: number): { fingers: (number | null)[]; barre?: FretVoicing['barre']; count: number } {
  const fingers: (number | null)[] = frets.map((f) => (f === null ? null : f <= capo ? 0 : -1));
  const fretted = frets.map((f, i) => ({ f, i })).filter((x) => x.f !== null && x.f > capo) as { f: number; i: number }[];
  if (!fretted.length) return { fingers, count: 0 };
  const min = Math.min(...fretted.map((x) => x.f));
  const atMin = fretted.filter((x) => x.f === min);
  let barre: FretVoicing['barre'];
  let finger = 1;
  if (atMin.length >= 2) {
    const from = atMin[0].i;
    const to = atMin[atMin.length - 1].i;
    // A barre presses every string between: those must sound at or above the barre fret.
    const ok = frets.slice(from, to + 1).every((f) => f !== null && f >= min);
    if (ok) {
      barre = { fret: min, fromString: from + 1, toString: to + 1 };
      for (const x of atMin) fingers[x.i] = 1;
      finger = 2;
    }
  }
  const rest = fretted.filter((x) => fingers[x.i] === -1).sort((a, b) => a.f - b.f || a.i - b.i);
  for (const x of rest) fingers[x.i] = finger++;
  return { fingers, barre, count: finger - 1 };
}

function pitchesOf(frets: (number | null)[], tuning: number[]): number[] {
  return frets.map((f, i) => (f === null ? null : tuning[i] + f)).filter((p): p is number => p !== null);
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/**
 * Full chord shapes on a fretted instrument (3+ strings). Searched in 4-fret windows up the neck:
 * every required note present, lowest note = the bass, at most 4 fingers (a barre counts once).
 */
export function chordShapes(c: ChordSpec, tuning: number[], capo = 0, maxFret = 15): FretVoicing[] {
  const n = chordNotes(c);
  const allow = new Set(n.all);
  const req = n.required;
  const strings = tuning.length;
  const out = new Map<string, FretVoicing & { score: number }>();
  for (let base = capo + 1; base <= maxFret - 3; base++) {
    const options = tuning.map((open) => {
      const opts: (number | null)[] = [null];
      if (allow.has(mod12(open + capo))) opts.push(capo);
      for (let f = base; f <= base + 3; f++) if (allow.has(mod12(open + f))) opts.push(f);
      return opts;
    });
    const cur: (number | null)[] = new Array(strings).fill(null);
    const rec = (s: number) => {
      if (s === strings) {
        consider(cur.slice());
        return;
      }
      for (const o of options[s]) {
        cur[s] = o;
        rec(s + 1);
      }
    };
    const consider = (frets: (number | null)[]) => {
      const played = frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0);
      if (played.length < Math.min(3, strings)) return;
      const lo = played[0];
      const hi = played[played.length - 1];
      const gaps = hi - lo + 1 - played.length;
      if (gaps > (req.length >= 4 ? 1 : 0)) return;
      const pitches = pitchesOf(frets, tuning);
      const sorted = [...pitches].sort((a, b) => a - b);
      if (mod12(sorted[0]) !== c.bass) return;
      if (tuning[lo] + (frets[lo] as number) !== sorted[0]) return; // bass on the lowest played string
      const pcs = new Set(pitches.map(mod12));
      if (!req.every((p) => pcs.has(p))) return;
      const fr = frets.filter((f): f is number => f !== null && f > capo);
      if (fr.length && Math.max(...fr) - Math.min(...fr) > 3) return;
      const fg = fingering(frets, capo);
      if (fg.count > 4) return;
      const key = frets.map((f) => (f === null ? 'x' : f)).join(',');
      if (out.has(key)) return;
      const hasOpen = frets.some((f) => f === capo);
      const top = fr.length ? Math.max(...fr) : capo;
      const kind: VoicingKind = hasOpen && top <= capo + 4 ? 'open' : fg.barre && fg.barre.toString - fg.barre.fromString >= 2 ? 'barre' : 'shape';
      const low = fr.length ? Math.min(...fr) : capo;
      const label = kind === 'open' ? (capo ? `Open (capo ${capo})` : 'Open')
        : kind === 'barre' ? `Barre, root on ${ORD[strings - 1 - lo] ?? ''} string, fret ${low}`
        : `Fret ${low}`;
      // Prefer: more strings, fewer fingers, lower on the neck, no gaps, root doubled on top.
      // Open strings ringing under a shape high up the neck are less practical.
      const drone = hasOpen && top > capo + 5 ? 6 : 0;
      const score = -played.length * 2 + fg.count * 1.5 + low * 0.4 + gaps * 4 + drone + (kind === 'open' ? -4 : 0) + (kind === 'barre' ? -1 : 0);
      out.set(key, { kind, label, frets: frets.slice(), fingers: fg.fingers, barre: fg.barre, pitches: sorted, score });
    };
    rec(0);
  }
  const list = [...out.values()].sort((a, b) => a.score - b.score);
  // Keep the best few per neck area so the list covers the whole neck.
  const kept: (FretVoicing & { score: number })[] = [];
  const perArea = new Map<string, number>();
  for (const v of list) {
    const fr = v.frets.filter((f): f is number => f !== null && f > capo);
    const area = v.kind + ':' + Math.floor((fr.length ? Math.min(...fr) : 0) / 3);
    const k = perArea.get(area) ?? 0;
    if (k >= 3) continue;
    perArea.set(area, k + 1);
    kept.push(v);
    if (kept.length >= 30) break;
  }
  return kept.map(({ score: _s, ...v }) => v);
}

/** Power chords (root + 5th, + octave when it fits), root on each of the lower strings. */
export function powerChords(c: ChordSpec, tuning: number[], capo = 0, maxFret = 15): FretVoicing[] {
  const n = chordNotes(c);
  if (c.bass !== c.root || !n.intervals.includes(7)) return [];
  const out: FretVoicing[] = [];
  for (let s = 0; s < tuning.length - 1 && s < 3; s++) {
    for (let f = capo; f <= maxFret - 2; f++) {
      if (mod12(tuning[s] + f) !== c.root) continue;
      const root = tuning[s] + f;
      const frets: (number | null)[] = tuning.map(() => null);
      frets[s] = f;
      const f5 = root + 7 - tuning[s + 1];
      if (f5 < capo || f5 > f + 3 || f5 < f - 1) continue;
      frets[s + 1] = f5;
      if (s + 2 < tuning.length) {
        const f8 = root + 12 - tuning[s + 2];
        if (f8 >= capo && f8 <= f + 3 && f8 >= f - 1) frets[s + 2] = f8;
      }
      const fg = fingering(frets, capo);
      out.push({ kind: 'power', label: `Power chord, root on ${ORD[tuning.length - 1 - s]} string, fret ${f}`, frets, fingers: fg.fingers, barre: fg.barre, pitches: pitchesOf(frets, tuning).sort((a, b) => a - b) });
    }
  }
  return out.slice(0, 6);
}

/** Close triads (root position + 2 inversions) on each set of 3 adjacent strings. */
export function triadShapes(c: ChordSpec, tuning: number[], capo = 0, maxFret = 15): FretVoicing[] {
  const n = chordNotes(c);
  const tri = n.intervals.filter((i) => i < 12).slice(0, 3).map((i) => mod12(c.root + i));
  if (tri.length < 3 || c.triad === '5') return [];
  const out: FretVoicing[] = [];
  const names = ['root position', '1st inversion', '2nd inversion'];
  for (let s = tuning.length - 3; s >= 0; s--) {
    for (let inv = 0; inv < 3; inv++) {
      const order = [tri[inv], tri[(inv + 1) % 3], tri[(inv + 2) % 3]];
      let best: (number | null)[] | null = null;
      let bestLow = Infinity;
      for (let f0 = capo; f0 <= maxFret; f0++) {
        if (mod12(tuning[s] + f0) !== order[0]) continue;
        let prev = tuning[s] + f0;
        const frets: (number | null)[] = tuning.map(() => null);
        frets[s] = f0;
        let ok = true;
        for (let k = 1; k < 3; k++) {
          let p = prev + 1;
          while (mod12(p) !== order[k]) p++;
          const f = p - tuning[s + k];
          if (f < capo || f > maxFret) { ok = false; break; }
          frets[s + k] = f;
          prev = p;
        }
        if (!ok) continue;
        const fr = frets.filter((f): f is number => f !== null);
        if (Math.max(...fr) - Math.min(...fr) > 4) continue;
        if (Math.min(...fr) < bestLow) {
          bestLow = Math.min(...fr);
          best = frets;
        }
      }
      if (best) {
        const fg = fingering(best, capo);
        out.push({
          kind: 'triad', label: `Triad, strings ${tuning.length - s - 2}-${tuning.length - s}, ${names[inv]}`,
          frets: best, fingers: fg.fingers, barre: fg.barre, pitches: pitchesOf(best, tuning).sort((a, b) => a - b),
        });
      }
    }
  }
  return out;
}

/** Bass shapes: root-5th-octave and the chord arpeggio from each root position. */
export function bassShapes(c: ChordSpec, tuning: number[], capo = 0, maxFret = 12): FretVoicing[] {
  const n = chordNotes(c);
  const out: FretVoicing[] = [];
  const shapes: { label: string; iv: number[] }[] = [
    { label: 'Root-5th-octave', iv: n.intervals.includes(7) ? [0, 7, 12] : [0, 12] },
    { label: 'Arpeggio', iv: n.intervals.filter((i) => i < 12) },
  ];
  for (let s = 0; s < Math.min(2, tuning.length); s++) {
    for (let f = Math.max(capo, 0); f <= maxFret; f++) {
      if (mod12(tuning[s] + f) !== c.bass) continue;
      const root = tuning[s] + f;
      for (const sh of shapes) {
        const frets: (number | null)[] = tuning.map(() => null);
        const notes: { s: number; f: number }[] = [];
        let ok = true;
        for (const i of sh.iv) {
          const p = root + i;
          // Lowest string at or above the previous note's string that reaches p within the box.
          let placed = false;
          for (let ss = notes.length ? notes[notes.length - 1].s : s; ss < tuning.length; ss++) {
            const ff = p - tuning[ss];
            if (ff >= capo && ff >= f - 1 && ff <= f + 4 && frets[ss] === null) {
              frets[ss] = ff;
              notes.push({ s: ss, f: ff });
              placed = true;
              break;
            }
          }
          if (!placed) { ok = false; break; }
        }
        if (!ok) continue;
        const fg = fingering(frets, capo);
        out.push({ kind: 'bass', label: `${sh.label}, root on ${ORD[tuning.length - 1 - s]} string, fret ${f}`, frets, fingers: fg.fingers, pitches: notes.map((x) => tuning[x.s] + x.f) });
      }
    }
  }
  return out;
}

/** Everything for a fretted track: full shapes, power chords, triads (guitar) or bass shapes (4-5 strings). */
export function fretVoicings(c: ChordSpec, tuning: number[], capo = 0): FretVoicing[] {
  const bass = tuning.length <= 5 && tuning[0] < 36;
  if (bass) return [...bassShapes(c, tuning, capo), ...powerChords(c, tuning, capo)];
  return [...chordShapes(c, tuning, capo), ...powerChords(c, tuning, capo), ...triadShapes(c, tuning, capo)];
}

// ---------------- piano ----------------

/** Piano voicings around middle C: close position + inversions, open (spread), drop 2. */
export function pianoVoicings(c: ChordSpec, around = 60): PianoVoicing[] {
  const n = chordNotes(c);
  const ivs = n.intervals;
  const out: PianoVoicing[] = [];
  const close = (tones: number[], low: number) => {
    const r: number[] = [];
    let p = low;
    for (const t of tones) {
      while (mod12(p) !== mod12(t)) p++;
      r.push(p);
      p++;
    }
    return r;
  };
  const tones = ivs.map((i) => mod12(c.root + i));
  const uniq = [...new Set(tones)];
  const start = around - 7;
  const withBass = (ps: number[]) => {
    if (c.bass === c.root) return ps;
    let b = ps[0] - 1;
    while (mod12(b) !== c.bass) b--;
    return [b, ...ps.filter((p) => mod12(p) !== c.bass)];
  };
  const names = ['Close, root position', '1st inversion', '2nd inversion', '3rd inversion', '4th inversion', '5th inversion'];
  for (let k = 0; k < Math.min(uniq.length, 4); k++) {
    const order = [...uniq.slice(k), ...uniq.slice(0, k)];
    out.push({ kind: k === 0 ? 'close' : 'inversion', label: names[k], pitches: withBass(close(order, start)) });
  }
  // Open: root low, then the rest spread over two octaves (5th, 3rd + octave, 7th + octave ...).
  const rootLow = close([c.bass], around - 19)[0];
  const upper = uniq.filter((t) => t !== c.bass);
  const open: number[] = [rootLow];
  let p = rootLow + 7;
  const ordered = [...upper].sort((a, b) => mod12(a - c.root) - mod12(b - c.root));
  // 5th first if present, then the rest an octave up.
  const fifth = ordered.find((t) => mod12(t - c.root) === 7 || mod12(t - c.root) === 6 || mod12(t - c.root) === 8);
  const seq = fifth !== undefined ? [fifth, ...ordered.filter((t) => t !== fifth)] : ordered;
  for (const t of seq) {
    while (mod12(p) !== t) p++;
    open.push(p);
    p += 3;
  }
  out.push({ kind: 'openPiano', label: 'Open (spread)', pitches: open });
  // Drop 2: close voicing, second note from the top dropped an octave.
  if (uniq.length >= 3) {
    // Up to 4 notes: leave out optional tones (the plain 5th, a 9th under an 11/13) first.
    const req = new Set(n.required);
    let core = uniq.slice();
    for (let i = core.length - 1; core.length > 4 && i >= 0; i--) if (!req.has(core[i])) core.splice(i, 1);
    core = core.slice(0, 4);
    const cl = close(core, start + 5);
    const d = [...cl];
    const idx = d.length - 2;
    d[idx] -= 12;
    d.sort((a, b) => a - b);
    out.push({ kind: 'drop2', label: 'Drop 2', pitches: withBass(d) });
  }
  return out;
}

/** Pitch classes of the chord (for checks). */
export function chordPcs(c: ChordSpec): Set<number> {
  return new Set(chordNotes(c).all);
}
