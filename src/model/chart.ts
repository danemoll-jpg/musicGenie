// Chord chart songs: type chords per bar and get a song the band panel can play.
//
//   {key: G} {tempo: 96} {4/4}
//   [Verse]
//   |: G | Em | C D | % :|
//   [Chorus] {key: A} {3/4}
//   | A | F#m | D / E | A :| x3
//   {rit 70 2}
//   | D | A |
//
// Bars are separated by "|". "|:" and ":|" mark repeats (":| x3" = play 3 times). "%" repeats
// the previous bar. Several chords in a bar share it evenly; "/" or "-" holds the previous chord
// for one more slot ("C / / G" = C for 3 beats, G for 1). [Name] starts a section. Directives in
// {braces} apply from the next bar: {key: Em}, {3/4} or {time: 6/8}, {tempo: 120},
// {accel 140 4} / {rit 80 2} (gradual change to 140/80 bpm over 4/2 bars).
import { parseChordSpec } from './chordTheory';
import { defaultBar, emptySong } from './factory';
import { keyFifths } from './progressions';
import { setTempoRamp } from './songChanges';
import { barTicks } from './timing';
import { PPQ, type BarHeader, type ChordSymbol, type Song } from './types';

const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

export interface ChartBar {
  /** One entry per slot (a held slot repeats the chord). */
  slots: string[];
  timeSignature: { numerator: number; denominator: number };
  key: { fifths: number; mode: 'major' | 'minor' };
  section?: string;
  repeatStart?: boolean;
  repeatEnd?: number;
  tempo?: number;
  ramp?: { bpm: number; bars: number };
}

export interface ChartParse {
  bars: ChartBar[];
  errors: string[];
  firstKeySet: boolean;
}

/** Key from a name like "G", "Em", "Bbm", "F# minor". */
export function parseKeyName(s: string): { fifths: number; mode: 'major' | 'minor' } | null {
  const m = /^\s*([A-G][#b]?)\s*(m|min|minor|maj|major)?\s*$/i.exec(s.replace(/^([a-g])/, (x) => x.toUpperCase()));
  if (!m) return null;
  const tonic = PC[m[1][0].toUpperCase() + m[1].slice(1)];
  if (tonic === undefined) return null;
  const mode = m[2] && /^m(in(or)?)?$/i.test(m[2]) && m[2] !== 'M' ? 'minor' : 'major';
  return { fifths: keyFifths({ tonic, mode }), mode };
}

export function parseChart(text: string): ChartParse {
  const errors: string[] = [];
  const bars: ChartBar[] = [];
  let ts = { numerator: 4, denominator: 4 };
  let key = { fifths: 0, mode: 'major' as 'major' | 'minor' };
  let firstKeySet = false;
  let pending: Partial<ChartBar> = {};
  let cur: string[] | null = null;
  let lineNo = 0;

  const flush = () => {
    if (cur && cur.length) {
      bars.push({ slots: cur, timeSignature: { ...ts }, key: { ...key }, ...pending });
      pending = {};
    }
    cur = null;
  };
  const directive = (d: string) => {
    const body = d.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(?:time:?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})$/i.exec(body))) {
      const den = Number(m[2]);
      if (![1, 2, 4, 8, 16, 32].includes(den) || Number(m[1]) < 1) errors.push(`Line ${lineNo}: bad time signature {${body}}`);
      else ts = { numerator: Number(m[1]), denominator: den };
    } else if ((m = /^key:?\s*(.+)$/i.exec(body))) {
      const k = parseKeyName(m[1]);
      if (!k) errors.push(`Line ${lineNo}: unknown key {${body}}`);
      else {
        key = k;
        if (!bars.length) firstKeySet = true;
      }
    } else if ((m = /^(?:tempo|bpm):?\s*(\d+(?:\.\d+)?)$/i.exec(body))) {
      pending.tempo = Number(m[1]);
    } else if ((m = /^(accel|rit|ritard|rall)\.?:?\s*(\d+(?:\.\d+)?)(?:\s+(\d+))?$/i.exec(body))) {
      pending.ramp = { bpm: Number(m[2]), bars: Number(m[3] ?? 4) };
    } else errors.push(`Line ${lineNo}: unknown direction {${body}}`);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++;
    const line = /^\s*\/\//.test(rawLine) ? '' : rawLine; // a line starting with // is a comment
    const re = /\[([^\]]+)\]|\{([^}]*)\}|\|:|:\|\s*(?:x\s*(\d+))?|\||([^\s|{}\[\]:]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const tok = m[0];
      if (m[1] !== undefined) {
        flush();
        pending.section = m[1].trim();
      } else if (m[2] !== undefined) {
        flush();
        directive(m[2]);
      } else if (tok === '|:') {
        flush();
        pending.repeatStart = true;
      } else if (tok.startsWith(':|')) {
        flush();
        const last = bars[bars.length - 1];
        if (last) last.repeatEnd = Math.max(2, Number(m[3] ?? 2));
        else errors.push(`Line ${lineNo}: ":|" with no bar before it`);
      } else if (tok === '|') {
        flush();
      } else {
        const word = m[4];
        if (!cur) cur = [];
        if (word === '%') {
          const prev = bars[bars.length - 1];
          if (prev) cur.push(...prev.slots);
          else errors.push(`Line ${lineNo}: "%" with no bar before it`);
        } else if (word === '/' || word === '-' || word === '.') {
          const prevChord = cur[cur.length - 1] ?? bars[bars.length - 1]?.slots.slice(-1)[0];
          if (prevChord) cur.push(prevChord);
        } else if (/^x\d+$/i.test(word)) {
          const last = bars[bars.length - 1];
          if (last?.repeatEnd) last.repeatEnd = Number(word.slice(1));
        } else if (parseChordSpec(word)) {
          cur.push(word.replace(/♯/g, '#').replace(/♭/g, 'b'));
        } else if (word === 'N.C.' || word === 'NC') {
          cur.push('N.C.');
        } else errors.push(`Line ${lineNo}: "${word}" is not a chord`);
      }
    }
    flush();
  }
  // Key from the first chord when no {key} was given before it.
  if (!firstKeySet && bars.length) {
    const first = bars[0].slots.find((s) => s !== 'N.C.');
    const c = first ? parseChordSpec(first) : null;
    if (c) {
      const k = { fifths: keyFifths({ tonic: c.root, mode: c.triad === 'min' ? 'minor' : 'major' }), mode: c.triad === 'min' ? 'minor' as const : 'major' as const };
      const original = { ...bars[0].key };
      for (const b of bars) {
        if (b.key.fifths === original.fifths && b.key.mode === original.mode) b.key = { ...k };
        else break;
      }
    }
  }
  return { bars, errors, firstKeySet };
}

/** Chord symbols for a bar's slots: equal slots, a held slot doesn't repeat the symbol. */
function barChords(bar: number, header: BarHeader, slots: string[]): ChordSymbol[] {
  const len = barTicks(header);
  const beat = (PPQ * 4) / header.timeSignature.denominator;
  const beats = Math.max(1, Math.round(len / beat));
  const out: ChordSymbol[] = [];
  slots.forEach((name, i) => {
    if (i > 0 && slots[i - 1] === name) return;
    if (name === 'N.C.') return;
    const tick = slots.length <= beats && beats % slots.length === 0
      ? (i * len) / slots.length
      : Math.min(len - beat, Math.round((i * beats) / slots.length) * beat);
    out.push({ bar, tick: Math.round(tick), name, source: 'user' });
  });
  return out;
}

/** Build a song (no tracks yet) from a chart. Throws with the parse errors if there are no bars. */
export function chartToSong(text: string, opts: { title?: string; bpm?: number } = {}): { song: Song; errors: string[] } {
  const p = parseChart(text);
  if (!p.bars.length) throw new Error(p.errors[0] ?? 'The chart has no bars. Write chords between bar lines, e.g. | C | Am | F G |');
  let song = emptySong(opts.title || 'Chord chart');
  song.tempos = [{ bar: 0, tick: 0, bpm: opts.bpm ?? 120 }];
  song.bars = p.bars.map((b) => {
    const h = defaultBar();
    h.timeSignature = { ...b.timeSignature };
    h.key = { ...b.key };
    if (b.repeatStart) h.repeatStart = true;
    if (b.repeatEnd) h.repeatEnd = b.repeatEnd;
    return h;
  });
  p.bars.forEach((b, i) => {
    song.chordSymbols.push(...barChords(i, song.bars[i], b.slots));
    if (b.section) song.sections.push({ bar: i, name: b.section });
    if (b.tempo !== undefined) {
      song.tempos = song.tempos.filter((t) => !(t.bar === i && t.tick === 0));
      song.tempos.push({ bar: i, tick: 0, bpm: b.tempo });
    }
  });
  song.tempos.sort((a, b) => a.bar - b.bar || a.tick - b.tick);
  p.bars.forEach((b, i) => {
    if (b.ramp) song = setTempoRamp(song, i, i + b.ramp.bars, b.ramp.bpm);
  });
  song.chart = { text };
  return { song, errors: p.errors };
}
