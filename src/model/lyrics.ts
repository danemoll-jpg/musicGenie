// Lyrics (Round 7): per-beat syllables, several verses, hyphens and held syllables.
//
// Stored on Beat.lyrics (index = verse, 0-based). A syllable that continues its word on the next
// syllable ends with "-" ("Freu-", "de"). "_" = this note holds the previous syllable (melisma).
// "" or missing = no lyric. Pure: no DOM / Electron.
import { barStartTicks, durationTicks } from './timing';
import { hashOf } from './events';
import { msAtTick, tempoPoints } from './tempo';
import type { Beat, Song, Track } from './types';

export const MELISMA = '_';

/** A beat that can carry a syllable: a sounded (not grace, not only-tied) beat of one voice. */
export interface LyricSlot {
  staff: number;
  bar: number;
  voice: number;
  beat: number;
  /** Absolute start tick (repeats not unrolled). */
  tick: number;
  /** Length in ticks, tied continuations included. */
  dur: number;
  /** Highest pitch of the beat (the melody note). */
  pitch: number;
  velocity: number;
}

export const beatLyric = (b: Beat, verse: number): string => b.lyrics?.[verse] ?? (verse === 0 ? b.lyric ?? '' : '');

/** Moves a legacy `lyric` into `lyrics[0]` (in place; used on load / import). */
export function normalizeLyrics(song: Song): Song {
  for (const t of song.tracks) for (const st of t.staves) for (const m of st.measures) for (const v of m.voices) for (const b of v.beats) {
    if (b.lyric !== undefined) {
      if (b.lyric && !b.lyrics?.[0]) b.lyrics = [b.lyric, ...(b.lyrics ?? []).slice(1)];
      delete b.lyric;
    }
    if (b.lyrics) {
      while (b.lyrics.length && !b.lyrics[b.lyrics.length - 1]) b.lyrics.pop();
      if (!b.lyrics.length) delete b.lyrics;
    }
  }
  return song;
}

/** Voice 0 of a staff is where lyrics live (the melody). */
export function lyricSlots(song: Song, track: Track, staff = 0, voice = 0): LyricSlot[] {
  const starts = barStartTicks(song);
  const out: LyricSlot[] = [];
  const st = track.staves[staff];
  if (!st) return out;
  let last: LyricSlot | null = null;
  st.measures.forEach((m, bi) => {
    const v = m.voices[voice];
    if (!v) { last = null; return; }
    let t = starts[bi] ?? 0;
    v.beats.forEach((b, i) => {
      const d = durationTicks(b.duration);
      if (b.grace) return;
      if (b.notes.length && b.notes.every((n) => n.tieFromPrevious) && last && last.tick + last.dur === t) {
        last.dur += d;
      } else if (b.notes.length) {
        last = { staff, bar: bi, voice, beat: i, tick: t, dur: d, pitch: Math.max(...b.notes.map((n) => n.pitch)), velocity: Math.max(...b.notes.map((n) => n.velocity)) };
        out.push(last);
      } else last = null;
      t += d;
    });
  });
  return out;
}

/** Number of verses used anywhere on the track. */
export function verseCount(track: Track): number {
  let n = 0;
  for (const st of track.staves) for (const m of st.measures) for (const v of m.voices) for (const b of v.beats) {
    const l = b.lyrics ?? (b.lyric ? [b.lyric] : []);
    for (let i = l.length - 1; i >= 0; i--) if (l[i]) { n = Math.max(n, i + 1); break; }
  }
  return n;
}

export function hasLyrics(track: Track): boolean {
  return verseCount(track) > 0;
}

// ------------------------------------------------------------------ syllables

const VOWEL = /[aeiouyäöüàáâèéêìíîòóôùúûæøå]/i;
const ONSETS = new Set(['bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'kn', 'ph', 'pl', 'pr', 'qu', 'sc', 'sch', 'scr',
  'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'spl', 'spr', 'squ', 'st', 'str', 'sw', 'th', 'thr', 'tr', 'tw', 'wh', 'wr', 'gn', 'shr']);
// Clusters that are never split (one sound).
const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'ck', 'ng', 'gh', 'qu']);

/**
 * Splits one English word into syllables (a heuristic, like most lyric tools: vowel groups, with
 * the consonants between them split so the next syllable starts with a pronounceable onset; silent
 * final "e" and "-ed" / "-es" endings do not count). Returns the word itself when unsure.
 */
export function syllabify(word: string): string[] {
  const m = /^([^\p{L}']*)([\p{L}']+)([^\p{L}']*)$/u.exec(word);
  if (!m) return [word];
  const [, pre, core, post] = m;
  if (core.length <= 3) return [word];
  const lower = core.toLowerCase();
  const isV = (i: number) => {
    const c = lower[i];
    if (!c) return false;
    if (c === 'y') return i > 0 && !VOWEL.test(lower[i - 1]);
    return VOWEL.test(c) && !(c === 'u' && lower[i - 1] === 'q');
  };
  // Vowel groups: [start, end) indices.
  const groups: [number, number][] = [];
  for (let i = 0; i < lower.length;) {
    if (isV(i)) {
      let j = i + 1;
      while (j < lower.length && isV(j)) j++;
      groups.push([i, j]);
      i = j;
    } else i++;
  }
  // Silent endings: "e" (but not "le" after a consonant), "es"/"ed" after most consonants.
  const last = groups[groups.length - 1];
  if (groups.length > 1 && last) {
    const tail = lower.slice(last[0]);
    const before = lower[last[0] - 1] ?? '';
    const silentE = tail === 'e' && !(before === 'l' && !VOWEL.test(lower[last[0] - 2] ?? ''));
    const silentEs = (tail === 'es' && !/[sxzh]/.test(before) && before !== 'c' && before !== 'g') || (tail === 'ed' && !/[td]/.test(before));
    if (silentE || silentEs) groups.pop();
  }
  if (groups.length < 2) return [word];
  const cuts: number[] = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const a = groups[g][1];
    const b = groups[g + 1][0];
    const cons = lower.slice(a, b);
    let cut: number;
    if (cons.length === 0) cut = a; // two vowel groups touching (rare after grouping)
    else if (cons.length === 1) cut = a; // V-CV
    else {
      // Longest pronounceable onset at the end of the cluster, the rest closes the syllable.
      let k = cons.length - 1;
      for (let len = Math.min(3, cons.length); len >= 2; len--) {
        const tail = cons.slice(cons.length - len);
        if (ONSETS.has(tail) || DIGRAPHS.has(tail)) { k = cons.length - len; break; }
      }
      if (cons.length - k === 2 && DIGRAPHS.has(cons.slice(k)) && ['ck', 'ng', 'gh'].includes(cons.slice(k))) k = cons.length; // "ck"/"ng" close the syllable
      cut = a + Math.max(1, k);
      if (k === cons.length) cut = b;
    }
    cuts.push(cut);
  }
  const parts: string[] = [];
  let p = 0;
  for (const c of cuts) {
    if (c > p && c < core.length) { parts.push(core.slice(p, c)); p = c; }
  }
  parts.push(core.slice(p));
  const out = parts.filter(Boolean);
  if (out.length < 2) return [word];
  out[0] = pre + out[0];
  out[out.length - 1] += post;
  return out;
}

/**
 * A block of lyrics -> syllables in order. Words are split into syllables (unless written with
 * hyphens already: "Freu-de"; "--" keeps a hyphenated word together: "well--known"). "_" holds the
 * previous syllable on the next note, "*" (or "~") skips a note. Line breaks and spaces are equal.
 */
export function splitLyrics(text: string, auto = true): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, '').split(/\s+/)) {
    if (!raw) continue;
    if (/^_+$/.test(raw)) { for (let i = 0; i < raw.length; i++) out.push(MELISMA); continue; }
    if (raw === '*' || raw === '~') { out.push(''); continue; }
    const keep = raw.replace(/--/g, '‑');
    const parts = keep.split('-').filter((s, i, a) => s || i < a.length - 1);
    const sylls: string[] = [];
    if (parts.length > 1) sylls.push(...parts.filter(Boolean));
    else if (auto) sylls.push(...syllabify(keep));
    else sylls.push(keep);
    sylls.forEach((s, i) => {
      // A trailing "_" on a syllable ("joy_") = hold it on the next note too.
      const held = /_+$/.exec(s);
      const body = s.replace(/_+$/, '').replace(/‑/g, '-');
      out.push(body + (i < sylls.length - 1 ? '-' : ''));
      if (held) for (let k = 0; k < held[0].length; k++) out.push(MELISMA);
    });
  }
  return out;
}

/** Syllables of one verse back to editable text ("Freu- de" -> "Freu-de", "_" kept). */
export function joinSyllables(sylls: string[]): string {
  let out = '';
  let prevHyphen = false;
  for (const s of sylls) {
    if (!s) { out += (out && !prevHyphen ? ' ' : '') + '*'; prevHyphen = false; continue; }
    if (s === MELISMA) { out += ' _'; continue; }
    out += (out && !prevHyphen ? ' ' : '') + s;
    prevHyphen = s.endsWith('-') && s.length > 1;
  }
  return out.replace(/(\* )+$/, '').replace(/ ?\*$/, '').trim();
}

// ------------------------------------------------------------------ edits

function cloneTrackBeats(song: Song, trackId: string): { song: Song; track: Track } | null {
  const ti = song.tracks.findIndex((t) => t.id === trackId);
  if (ti < 0) return null;
  const track: Track = structuredClone(song.tracks[ti]);
  const tracks = song.tracks.slice();
  tracks[ti] = track;
  return { song: { ...song, tracks }, track };
}

function setOn(b: Beat, verse: number, text: string) {
  if (b.lyric !== undefined) { if (b.lyric) b.lyrics = [b.lyric, ...(b.lyrics ?? []).slice(1)]; delete b.lyric; }
  const l = b.lyrics ? b.lyrics.slice() : [];
  while (l.length <= verse) l.push('');
  l[verse] = text;
  while (l.length && !l[l.length - 1]) l.pop();
  if (l.length) b.lyrics = l;
  else delete b.lyrics;
}

const beatAt = (t: Track, s: LyricSlot) => t.staves[s.staff].measures[s.bar].voices[s.voice].beats[s.beat];

/** The syllables of one verse, one per slot ("" = none). */
export function verseSyllables(song: Song, track: Track, verse: number, staff = 0): string[] {
  return lyricSlots(song, track, staff).map((s) => beatLyric(beatAt(track, s), verse));
}

/** Writes syllables onto the slots from `from` on (one per slot); later slots of the verse are cleared. */
export function writeVerse(song: Song, trackId: string, verse: number, sylls: string[], from = 0, staff = 0): Song {
  const c = cloneTrackBeats(song, trackId);
  if (!c) return song;
  const slots = lyricSlots(c.song, c.track, staff);
  // Clear the verse on every beat of the staff from the first slot on (incl. rests / tied beats).
  const first = slots[from];
  c.track.staves[staff]?.measures.forEach((m, bi) => m.voices.forEach((v) => v.beats.forEach((b, i) => {
    if (!first || bi > first.bar || (bi === first.bar && i >= first.beat)) setOn(b, verse, '');
  })));
  sylls.forEach((s, i) => {
    const slot = slots[from + i];
    if (slot) setOn(beatAt(c.track, slot), verse, s);
  });
  return c.song;
}

/** Paste a block of lyrics onto a melody track (verse = 0-based), starting at slot `from`. */
export function pasteLyrics(song: Song, trackId: string, verse: number, text: string, from = 0, auto = true): { song: Song; syllables: number; slots: number; overflow: number } {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) return { song, syllables: 0, slots: 0, overflow: 0 };
  const sylls = splitLyrics(text, auto);
  const slots = lyricSlots(song, track).length;
  return { song: writeVerse(song, trackId, verse, sylls, from), syllables: sylls.length, slots, overflow: Math.max(0, from + sylls.length - slots) };
}

/** Type one syllable onto one slot. */
export function setSyllable(song: Song, trackId: string, verse: number, slot: number, text: string): Song {
  const c = cloneTrackBeats(song, trackId);
  if (!c) return song;
  const s = lyricSlots(c.song, c.track)[slot];
  if (!s) return song;
  setOn(beatAt(c.track, s), verse, text.trim());
  return c.song;
}

/**
 * Drag: the syllable on slot `from` (and every syllable after it) moves to slot `to`. Moving right
 * leaves the gap empty; moving left overwrites the slots in between.
 */
export function moveSyllables(song: Song, trackId: string, verse: number, from: number, to: number): Song {
  if (from === to) return song;
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) return song;
  const sylls = verseSyllables(song, track, verse);
  const next = to > from
    ? [...sylls.slice(0, from), ...new Array<string>(to - from).fill(''), ...sylls.slice(from)]
    : [...sylls.slice(0, to), ...sylls.slice(from)];
  while (next.length && !next[next.length - 1]) next.pop();
  return writeVerse(song, trackId, verse, next);
}

export function clearVerse(song: Song, trackId: string, verse: number): Song {
  return writeVerse(song, trackId, verse, []);
}

// ------------------------------------------------------------------ events (export, singing, Rocksmith)

export interface LyricEvent {
  /** Start / length in ticks. A held syllable (melisma) covers its "_" notes too. */
  tick: number;
  dur: number;
  /** Start / length in ms through the tempo map. */
  ms: number;
  durMs: number;
  /** Syllable without its trailing hyphen. */
  text: string;
  /** The word continues on the next syllable. */
  hyphen: boolean;
  /** The pitches sung, one per note (more than one = melisma). */
  notes: { tick: number; dur: number; pitch: number }[];
  /** Index of the first slot. */
  slot: number;
  velocity: number;
}

/** The sung syllables of one verse in time order (verse 0 = first). */
export function lyricEvents(song: Song, track: Track, verse = 0, staff = 0): LyricEvent[] {
  const slots = lyricSlots(song, track, staff);
  const pts = tempoPoints(song);
  const out: LyricEvent[] = [];
  let cur: LyricEvent | null = null;
  slots.forEach((s, i) => {
    const t = beatLyric(beatAt(track, s), verse);
    if (t === MELISMA && cur) {
      cur.notes.push({ tick: s.tick, dur: s.dur, pitch: s.pitch });
      cur.dur = s.tick + s.dur - cur.tick;
      return;
    }
    cur = null;
    if (!t || t === MELISMA) return;
    const hyphen = t.length > 1 && t.endsWith('-');
    cur = { tick: s.tick, dur: s.dur, ms: 0, durMs: 0, text: hyphen ? t.slice(0, -1) : t, hyphen, notes: [{ tick: s.tick, dur: s.dur, pitch: s.pitch }], slot: i, velocity: s.velocity };
    out.push(cur);
  });
  for (const e of out) {
    e.ms = msAtTick(pts, e.tick);
    e.durMs = msAtTick(pts, e.tick + e.dur) - e.ms;
  }
  return out;
}

/** What the singer needs: syllables with their notes in ms (input of src/ml/sing.ts). */
export function singingInput(song: Song, track: Track, verse = 0): { text: string; hyphen: boolean; velocity: number; notes: { ms: number; durMs: number; pitch: number }[] }[] {
  const pts = tempoPoints(song);
  return lyricEvents(song, track, verse).map((e) => ({
    text: e.text, hyphen: e.hyphen, velocity: e.velocity,
    notes: e.notes.map((n) => { const ms = msAtTick(pts, n.tick); return { ms, durMs: msAtTick(pts, n.tick + n.dur) - ms, pitch: n.pitch }; }),
  }));
}

/** MusicXML <syllabic> of each syllable in a verse (hyphen chain). */
export function syllabicOf(prevHyphen: boolean, hyphen: boolean): 'single' | 'begin' | 'middle' | 'end' {
  if (hyphen) return prevHyphen ? 'middle' : 'begin';
  return prevHyphen ? 'end' : 'single';
}

/** MusicXML text pre-pass: alphaTab's importer drops <syllabic>, so "begin"/"middle" get a "-". */
export function musicXmlKeepHyphens(xml: string): string {
  return xml.replace(/<lyric\b[^>]*>[\s\S]*?<\/lyric>/g, (block) => {
    if (!/<syllabic>\s*(begin|middle)\s*<\/syllabic>/.test(block)) return block;
    return block.replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text>)(?![\s\S]*<text)/, (_m, a, t, b) => (t.endsWith('-') ? a + t + b : `${a}${t}-${b}`));
  });
}

/** What a sung rendering depends on: change any of it and the vocal is out of date. */
export function voiceHash(song: Song, track: Track, verse: number, settings: object): string {
  return hashOf({ s: singingInput(song, track, verse), settings });
}

/**
 * Recognised words (song time in ms) -> syllables on a melody track's notes (verse 0). Each word's
 * syllables go on the notes that start in its time window (from 150 ms before the word to the next
 * word); extra notes in the window hold the last syllable ("_"); a word with fewer notes than
 * syllables goes whole onto its first note.
 */
export function placeWords(song: Song, trackId: string, words: { word: string; ms: number; endMs?: number }[], verse = 0): { song: Song; placed: number; words: number } {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) return { song, placed: 0, words: 0 };
  const pts = tempoPoints(song);
  const slots = lyricSlots(song, track).map((s) => ({ ...s, ms: msAtTick(pts, s.tick) }));
  const sylls: string[] = new Array(slots.length).fill('');
  const ws = words.filter((w) => w.word.trim()).sort((a, b) => a.ms - b.ms);
  let placed = 0;
  let si = 0;
  ws.forEach((w, k) => {
    const from = w.ms - 150;
    const to = Math.min(ws[k + 1] ? ws[k + 1].ms - 150 : Infinity, w.endMs !== undefined ? w.endMs + 250 : w.ms + 4000);
    while (si < slots.length && slots[si].ms < from) si++;
    const mine: number[] = [];
    for (let j = si; j < slots.length && slots[j].ms < to; j++) mine.push(j);
    if (!mine.length) return;
    const parts = syllabify(w.word.trim());
    if (parts.length > mine.length) {
      sylls[mine[0]] = w.word.trim();
    } else {
      parts.forEach((p, i) => { sylls[mine[i]] = p + (i < parts.length - 1 ? '-' : ''); });
      for (let i = parts.length; i < mine.length; i++) sylls[mine[i]] = MELISMA;
    }
    placed++;
    si = mine[mine.length - 1] + 1;
  });
  return { song: writeVerse(song, trackId, verse, sylls), placed, words: ws.length };
}
