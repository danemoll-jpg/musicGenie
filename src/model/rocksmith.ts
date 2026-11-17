// Rocksmith 2014 arrangements <-> our model. Pure: the .NET helper turns .psarc/XML into the JSON
// described here (RsArrangement) and back; this file only converts that JSON.
//
// Rocksmith charts are time-based (ms) with beat markers ("ebeats"; a beat with measure >= 0 starts
// a bar). Strings are 0-based from the lowest; tunings are per-string offsets from standard; frets
// count from the nut (also with a capo), like our model.
import { buildMeasures, trackEvents, type NoteEvent } from './events';
import { assignChord } from './fretting';
import { findInstrument, toInstrumentRef } from './instruments';
import { tempoPoints, msAtTick, songEndTick } from './tempo';
import { barStartTicks, barTicks, durationTicks } from './timing';
import { lyricEvents } from './lyrics';
import {
  PPQ, type BarHeader, type BendPoint, type ChordSymbol, type RsArrangementType, type Section, type Song,
  type TempoChange, type Techniques, type Track,
} from './types';

// ---------- the helper's JSON ----------

export interface RsNote {
  t: number;
  s: number;
  f: number;
  sus: number;
  mask: number;
  slideTo: number;
  slideUnpitchTo: number;
  tap: number;
  vib: number;
  lh?: number;
  bends: [number, number][];
}

export interface RsChord {
  t: number;
  id: number;
  mask: number;
  notes: RsNote[];
}

export interface RsChordTemplate {
  name: string;
  displayName: string;
  frets: number[];
  fingers: number[];
}

export interface RsArrangement {
  /** Lead / Rhythm / Combo / Bass */
  name: string;
  priority?: string;
  tuning: number[];
  capo: number;
  centOffset?: number;
  songLength?: number;
  averageTempo?: number;
  pathBass?: boolean;
  pathLead?: boolean;
  pathRhythm?: boolean;
  bassPick?: boolean;
  bassPicked?: boolean;
  beats: [number, number][];
  phrases: { name: string; maxDifficulty: number }[];
  phraseIterations: [number, number][];
  sections: { name: string; t: number; n: number }[];
  chordTemplates: RsChordTemplate[];
  notes: RsNote[];
  chords: RsChord[];
  anchors: [number, number, number][];
  handShapes: [number, number, number][];
  tone?: string | null;
  // read-only extras from the helper
  levels?: number;
  hardest?: { singleNotes: number; chords: number; chordNotes: number; total: number };
  sourceXmlHardest?: { singleNotes: number; chords: number; chordNotes: number; total: number } | null;
}

export interface RsReadResult {
  title: string;
  artist: string;
  album: string;
  year: number;
  dlcKey?: string;
  audioOgg?: string | null;
  audioWav?: string | null;
  albumArt?: string;
  previewStart?: number | null;
  arrangements: RsArrangement[];
  /** Round 7: the vocals arrangement (lyrics), if the file has one. */
  vocals?: RsVocal[] | null;
}

/** One Rocksmith vocal: time/length in ms, MIDI note, lyric ("Freu-" joins the next syllable, "+" ends a line). */
export interface RsVocal {
  time: number;
  length: number;
  lyric: string;
  note: number;
}

// Note mask bits (Rocksmith2014.XML NoteMask / ChordMask).
export const NM = {
  LinkNext: 1, Accent: 2, HammerOn: 4, Harmonic: 8, Ignore: 16, FretHandMute: 32, PalmMute: 64, PullOff: 128,
  Tremolo: 256, PinchHarmonic: 512, PickDirection: 1024, Slap: 2048, Pluck: 4096, RightHand: 8192,
} as const;
export const CM = { LinkNext: 1, Accent: 2, FretHandMute: 4, HighDensity: 8, Ignore: 16, PalmMute: 32, Hopo: 64 } as const;

export const RS_GUITAR_STANDARD = [40, 45, 50, 55, 59, 64];
export const RS_BASS_STANDARD = [28, 33, 38, 43];

/** Rocksmith 2014's section names (case-insensitive in the game). */
export const RS_SECTION_NAMES = [
  'intro', 'outro', 'verse', 'chorus', 'bridge', 'solo', 'riff', 'prechorus', 'postchorus', 'breakdown',
  'interlude', 'hook', 'noguitar', 'transition', 'ambient', 'buildup', 'fadein', 'fadeout', 'tapping', 'vamp',
  'variation', 'modverse', 'modchorus', 'modbridge', 'head', 'melody', 'silence', 'chordbreak', 'postvs',
  'postbrdg', 'preverse', 'bre',
];

const DISPLAY_SECTION: Record<string, string> = {
  intro: 'Intro', outro: 'Outro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', solo: 'Solo', riff: 'Riff',
  prechorus: 'Pre-Chorus', postchorus: 'Post-Chorus', breakdown: 'Breakdown', interlude: 'Interlude', hook: 'Hook',
  noguitar: 'No guitar', transition: 'Transition', ambient: 'Ambient', buildup: 'Build-up', fadein: 'Fade in',
  fadeout: 'Fade out', tapping: 'Tapping', vamp: 'Vamp', variation: 'Variation', modverse: 'Verse (mod)',
  modchorus: 'Chorus (mod)', modbridge: 'Bridge (mod)', head: 'Head', melody: 'Melody', silence: 'Silence',
  chordbreak: 'Chord break', postvs: 'Post-verse', postbrdg: 'Post-bridge', preverse: 'Pre-verse', bre: 'Breakdown',
};

export function sectionFromRs(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  return DISPLAY_SECTION[k] ?? (name ? name[0].toUpperCase() + name.slice(1) : 'Riff');
}

export function sectionToRs(name: string): string {
  const mod = /\(mod\)/i.test(name);
  const k = name.toLowerCase().replace(/\(mod\)/g, '').replace(/[^a-z]/g, '');
  const key = mod ? 'mod' + k : k;
  if (RS_SECTION_NAMES.includes(key)) return key;
  if (RS_SECTION_NAMES.includes(k)) return k;
  return 'riff';
}

export function rsStandard(type: string, strings: number): number[] {
  return type === 'Bass' || strings === 4 ? RS_BASS_STANDARD : RS_GUITAR_STANDARD;
}

// ================= import =================

const GRID = PPQ / 8; // 32nd notes

export interface RsImportReport {
  arrangements: { name: string; notes: number; chords: number; skippedBeforeFirstBeat: number; moved: number }[];
  /** Round 7: the vocals arrangement, if any. */
  vocals?: { syllables: number; lines: number };
}

export interface BeatGrid {
  times: number[];
  /** Time -> absolute tick (each ebeat is one beat of its bar). */
  tickAt: (ms: number) => number;
  beatTicks: number[];
}

/** Bars, tempo map and a time -> tick function from Rocksmith beat markers. */
export function barsFromBeats(input: [number, number][]): { bars: BarHeader[]; tempos: TempoChange[]; grid: BeatGrid; firstBeatMs: number } {
  if (input.length < 2) throw new Error('This arrangement has no beat markers.');
  // Charting leftovers: a marker a few ms before the next one is not a beat. Drop it (its bar
  // number moves to the next marker).
  const gaps = input.slice(1).map((b, i) => b[0] - input[i][0]).sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1] || 500;
  const beats: [number, number][] = [];
  for (let i = 0; i < input.length; i++) {
    const cur: [number, number] = [input[i][0], input[i][1]];
    const next = input[i + 1];
    if (next && next[0] - cur[0] < median * 0.25) {
      if (cur[1] >= 0 && next[1] < 0) input[i + 1] = [next[0], cur[1]];
      continue;
    }
    beats.push(cur);
  }
  const times = beats.map((b) => b[0]);
  // Bar starts: beats with a measure number; anything before the first one is a pick-up bar.
  const starts: number[] = [];
  beats.forEach((b, i) => {
    if (b[1] >= 0) starts.push(i);
  });
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  // The last marker usually only closes the previous beat: drop a final bar with a single beat.
  const lastStart = starts[starts.length - 1];
  if (starts.length > 1 && beats.length - lastStart <= 1) starts.pop();

  const bars: BarHeader[] = [];
  const barBeatCounts: number[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : beats.length - 1;
    const n = Math.max(1, Math.min(32, end - starts[k]));
    barBeatCounts.push(n);
    bars.push({ timeSignature: { numerator: n, denominator: 4 }, key: { fifths: 0, mode: 'major' } });
  }
  // Every ebeat is a quarter note at its own tempo.
  const beatTicks = times.map((_, i) => i * PPQ);
  const interval = (i: number) => {
    if (i + 1 < times.length) return times[i + 1] - times[i];
    return times[i] - times[i - 1];
  };
  const tempos: TempoChange[] = [];
  let lastBpm = -1;
  starts.forEach((s, k) => {
    for (let j = 0; j < barBeatCounts[k]; j++) {
      const i = s + j;
      if (i >= times.length) break;
      const d = interval(i);
      const bpm = Math.round((60000 / Math.max(1, d)) * 1000) / 1000;
      if (Math.abs(bpm - lastBpm) >= 0.001) {
        tempos.push({ bar: k, tick: j * PPQ, bpm });
        lastBpm = bpm;
      }
    }
  });
  const tickAt = (ms: number) => {
    if (ms <= times[0]) return ((ms - times[0]) / interval(0)) * PPQ;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= ms) lo = mid;
      else hi = mid - 1;
    }
    return beatTicks[lo] + ((ms - times[lo]) / interval(lo)) * PPQ;
  };
  return { bars, tempos, grid: { times, tickAt, beatTicks }, firstBeatMs: times[0] };
}

function bendsFromRs(n: RsNote): BendPoint[] | undefined {
  if (!n.bends?.length) return undefined;
  const pts: BendPoint[] = [];
  for (const [bt, step] of n.bends) {
    const position = n.sus > 0 ? Math.max(0, Math.min(60, Math.round(((bt - n.t) / n.sus) * 60))) : 30;
    pts.push({ position, value: Math.round(step * 4) });
  }
  pts.sort((a, b) => a.position - b.position);
  if (pts[0].position > 0) pts.unshift({ position: 0, value: 0 });
  const last = pts[pts.length - 1];
  if (last.position < 60) pts.push({ position: 60, value: last.value });
  return pts;
}

function techniquesFromRs(n: RsNote, chordMask = 0): Techniques {
  const m = n.mask | 0;
  const q: Techniques = {};
  if (m & NM.HammerOn) q.hammerOn = true;
  if (m & NM.PullOff) q.pullOff = true;
  if (m & NM.Accent || chordMask & CM.Accent) q.accent = 'normal';
  if (m & NM.Harmonic) q.harmonic = 'natural';
  if (m & NM.PinchHarmonic) q.harmonic = 'pinch';
  if (m & NM.FretHandMute || chordMask & CM.FretHandMute) q.dead = true;
  if (m & NM.PalmMute || chordMask & CM.PalmMute) q.palmMute = true;
  if (m & NM.Tremolo) q.tremolo = true;
  if (m & NM.Slap) q.slap = true;
  if (m & NM.Pluck) q.pop = true;
  if (n.tap > 0) q.tap = true;
  if (n.vib > 0) q.vibrato = 'slight';
  if (n.slideUnpitchTo >= 0) q.slideOut = n.slideUnpitchTo >= n.f ? 'outUp' : 'outDown';
  const bend = bendsFromRs(n);
  if (bend) q.bend = bend;
  return q;
}

const ARR_INSTRUMENT: Record<string, string> = {
  Bass: 'fingered-bass', Lead: 'overdrive-guitar', Rhythm: 'electric-guitar-clean', Combo: 'electric-guitar-clean',
};

function arrangementType(name: string): RsArrangementType {
  if (name === 'Bass') return 'Bass';
  if (name === 'Rhythm' || name === 'Combo') return 'Rhythm';
  return 'Lead';
}

/** One Rocksmith arrangement -> a track (staves measured against `song`'s bars). */
function trackFromRs(song: Song, arr: RsArrangement, grid: BeatGrid, id: string, name: string) {
  const type = arrangementType(arr.name);
  const strings = type === 'Bass' ? 4 : 6;
  const std = rsStandard(type, strings);
  const tuning = std.map((p, i) => p + (arr.tuning[i] ?? 0));
  const c = findInstrument(arr.bassPicked || arr.bassPick ? 'picked-bass' : ARR_INSTRUMENT[arr.name] ?? 'overdrive-guitar')!;

  // Flatten notes and chord notes into timed notes.
  interface TN { t: number; n: RsNote; chordMask: number; chordName?: string; inChord: boolean }
  const timed: TN[] = arr.notes.map((n) => ({ t: n.t, n, chordMask: 0, inChord: false }));
  for (const ch of arr.chords) {
    const tpl = arr.chordTemplates[ch.id];
    const notes: RsNote[] = ch.notes?.length
      ? ch.notes
      : (tpl?.frets ?? [])
          .map((f, s): RsNote | null => (f >= 0 ? { t: ch.t, s, f, sus: 0, mask: 0, slideTo: -1, slideUnpitchTo: -1, tap: 0, vib: 0, bends: [] } : null))
          .filter((x): x is RsNote => !!x);
    const nm = (tpl?.displayName || tpl?.name || '').replace(/-(arp|nop)$/, '');
    for (const n of notes) timed.push({ t: ch.t, n, chordMask: ch.mask, chordName: nm, inChord: true });
  }
  timed.sort((a, b) => a.t - b.t || a.n.s - b.n.s);

  // Next note on the same string (for slides).
  const nextOnString = new Map<TN, TN>();
  const lastOn = new Map<number, TN>();
  for (let i = timed.length - 1; i >= 0; i--) {
    const x = timed[i];
    const nx = lastOn.get(x.n.s);
    if (nx) nextOnString.set(x, nx);
    lastOn.set(x.n.s, x);
  }

  // Quantise to the grid; a note landing on a busy string moves one grid step later.
  const q = (ms: number) => Math.round(grid.tickAt(ms) / GRID) * GRID;
  const onsets = [...new Set(timed.map((x) => q(x.t)))].sort((a, b) => a - b);
  const busy = new Set<string>();
  let skipped = 0;
  let moved = 0;
  const events: NoteEvent[] = [];
  for (const x of timed) {
    let start = q(x.t);
    if (start < 0) {
      skipped++;
      continue;
    }
    while (busy.has(`${start}:${x.n.s}`)) {
      start += GRID;
      moved++;
    }
    busy.add(`${start}:${x.n.s}`);
    let dur: number;
    if (x.n.sus > 0) dur = Math.max(GRID, q(x.t + x.n.sus) - q(x.t));
    else {
      const nextOnset = onsets.find((o) => o > start);
      dur = Math.max(GRID, Math.min(PPQ, (nextOnset ?? start + PPQ) - start));
    }
    const tq = techniquesFromRs(x.n, x.chordMask);
    if (x.n.slideTo >= 0) {
      const nx = nextOnString.get(x);
      const linked = (x.n.mask & NM.LinkNext) !== 0;
      tq.slideOut = linked ? 'legato' : 'shift';
      if (!nx || nx.n.f !== x.n.slideTo) tq.slideToFret = x.n.slideTo;
    }
    const pitch = tuning[x.n.s] + x.n.f;
    const e: NoteEvent = { start, dur, pitch, velocity: 96, string: x.n.s + 1, fret: x.n.f, staff: 0, voice: 0 };
    if (Object.keys(tq).length) e.techniques = tq;
    events.push(e);
  }
  const staves: Track['staves'] = [{ clef: type === 'Bass' ? 'bass' : 'treble', measures: buildMeasures(song, events, { tuning }) }];
  const track: Track = {
    id, name,
    instrument: toInstrumentRef(c),
    tuning,
    displayTranspose: c.displayTranspose ?? -12,
    mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
    display: { visible: true, mode: 'tab' },
    staves,
    rocksmith: { arrangement: type, tone: arr.tone ?? undefined, centOffset: arr.centOffset || undefined },
  };
  if (arr.capo) track.capo = arr.capo;
  return { track, events, timed, skipped, moved, chords: arr.chords.length };
}

/** Rocksmith vocals -> a "Vocals" track (choir sound) with one syllable per note, lines kept as "+"-free text. */
export function vocalsTrackFromRs(song: Song, vocals: RsVocal[], grid: BeatGrid, id: string): { track: Track; syllables: number; lines: number } | null {
  const q = (ms: number) => Math.round(grid.tickAt(ms) / GRID) * GRID;
  const events: NoteEvent[] = [];
  const lyricAt = new Map<number, string>();
  let lines = 0;
  for (const v of [...vocals].sort((a, b) => a.time - b.time)) {
    let start = q(v.time);
    if (start < 0) continue;
    while (lyricAt.has(start)) start += GRID;
    const end = Math.max(start + GRID, q(v.time + Math.max(1, v.length)));
    const pitch = v.note >= 24 && v.note <= 108 ? v.note : 60;
    let text = v.lyric.trim();
    if (text.endsWith('+')) { lines++; text = text.slice(0, -1); }
    lyricAt.set(start, text || '_');
    events.push({ start, dur: end - start, pitch, velocity: 90, staff: 0, voice: 0 });
  }
  if (!events.length) return null;
  // Overlaps would become chords: cut each note at the next one's start.
  for (let i = 0; i + 1 < events.length; i++) events[i].dur = Math.max(GRID, Math.min(events[i].dur, events[i + 1].start - events[i].start));
  const c = findInstrument('choir')!;
  const track: Track = {
    id, name: 'Vocals',
    instrument: toInstrumentRef(c),
    mixer: { volume: 0.6, pan: 0, mute: true, solo: false },
    display: { visible: true, mode: 'notation' },
    staves: [{ clef: 'treble', measures: buildMeasures(song, events, {}) }],
  };
  // Syllables onto the notes at their start ticks.
  const starts = barStartTicks(song);
  track.staves[0].measures.forEach((m, bi) => {
    let t = starts[bi];
    for (const b of m.voices[0]?.beats ?? []) {
      const l = !b.grace && b.notes.length && !b.notes.every((n) => n.tieFromPrevious) ? lyricAt.get(t) : undefined;
      if (l) b.lyrics = [l];
      if (!b.grace) t += durationTicks(b.duration);
    }
  });
  return { track, syllables: events.length, lines };
}

// Characters Rocksmith's default lyrics font has (Rocksmith2014.NET VocalsChecker.LyricsCharset).
const RS_LYRIC_CHARS = new Set(Array.from(" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~¡¢¥¦§¨ª«°²³´•¸¹º»¼½¾¿ÀÁÂÄÅÆÇÈÉÊËÌÎÏÑÒÓÔÖØÙÚÛÜÞßàáâäåæçèéêëìíîïñòóôöøùúûüŒœŠšž„…€™"));

/** A syllable in characters the game's lyrics font can show (curly quotes, dashes, other accents mapped). */
export function rsLyricText(s: string): string {
  const mapped = s.replace(/[‘’‚‛′]/g, "'").replace(/[“”‟″]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
  let out = '';
  for (const ch of mapped) {
    if (RS_LYRIC_CHARS.has(ch)) out += ch;
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += [...base].filter((c) => RS_LYRIC_CHARS.has(c)).join('');
    }
  }
  // 47 bytes is the game's limit per syllable.
  while (new TextEncoder().encode(out).length > 46) out = out.slice(0, -1);
  return out;
}

/**
 * Lyrics of a track -> Rocksmith vocals (times in ms, after `leadInMs`). Lines end ("+") at the end
 * of a sentence or clause (. , ; : ! ?), before a gap of a beat or more, or after 8 words.
 */
export function rocksmithVocals(song: Song, trackId: string, leadInMs: number, verse = 0): RsVocal[] {
  const t = song.tracks.find((x) => x.id === trackId);
  if (!t) return [];
  const ev = lyricEvents(song, t, verse);
  const out: RsVocal[] = [];
  let words = 0;
  ev.forEach((e, i) => {
    const next = ev[i + 1];
    const text = rsLyricText(e.text);
    if (!text && !e.hyphen) return;
    if (!e.hyphen) words++;
    const gap = next ? next.tick - (e.tick + e.dur) : Infinity;
    const lineEnd = !e.hyphen && (!next || /[.,;:!?]$/.test(text) || gap >= PPQ || words >= 8);
    if (lineEnd) words = 0;
    const pitch = Math.round(e.notes.reduce((a, n) => a + n.pitch * n.dur, 0) / Math.max(1, e.notes.reduce((a, n) => a + n.dur, 0)));
    out.push({ time: Math.round(leadInMs + e.ms), length: Math.max(1, Math.round(e.durMs)), lyric: (text || '-') + (e.hyphen ? '-' : lineEnd ? '+' : ''), note: pitch });
  });
  return out;
}

/** A whole Rocksmith song (all instrumental arrangements) -> Song. */
export function songFromRocksmith(r: RsReadResult): { song: Song; report: RsImportReport } {
  const arrs = r.arrangements.filter((a) => a.beats?.length);
  if (!arrs.length) throw new Error('This Rocksmith file has no guitar or bass arrangements.');
  const order = ['Lead', 'Rhythm', 'Combo', 'Bass'];
  arrs.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name) || (a.priority === 'Main' ? -1 : 1));
  const { bars, tempos, grid, firstBeatMs } = barsFromBeats(arrs[0].beats);
  const song: Song = {
    title: r.title || 'Untitled', artist: r.artist || '', album: r.album || '', composer: '',
    bars, tempos, sections: [], chordSymbols: [], tracks: [],
  };
  const starts = barStartTicks(song);
  const barOf = (tick: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= tick) i++;
    return i;
  };

  // Sections from the first arrangement.
  const secs: Section[] = [];
  for (const s of arrs[0].sections) {
    const tick = Math.max(0, Math.round(grid.tickAt(s.t)));
    const bar = Math.min(bars.length - 1, barOf(tick + PPQ / 4)); // a hair early still counts as that bar
    if (!secs.some((x) => x.bar === bar)) secs.push({ bar, name: sectionFromRs(s.name) });
  }
  song.sections = secs;

  const report: RsImportReport = { arrangements: [] };
  const used = new Map<string, number>();
  arrs.forEach((a, i) => {
    const base = a.name === 'Combo' ? 'Rhythm' : a.name;
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    const name = base + (k > 1 ? ` ${k}` : '') + (a.priority === 'Bonus' ? ' (bonus)' : a.priority === 'Alternative' ? ' (alt)' : '');
    const res = trackFromRs(song, a, grid, `t${i + 1}`, name);
    song.tracks.push(res.track);
    report.arrangements.push({ name, notes: res.events.length, chords: res.chords, skippedBeforeFirstBeat: res.skipped, moved: res.moved });
    // Chord names from the first arrangement that has any.
    if (!song.chordSymbols.length && a.chords.length) {
      const cs: ChordSymbol[] = [];
      let last = '';
      for (const ch of a.chords) {
        const tpl = a.chordTemplates[ch.id];
        const nm = (tpl?.displayName || tpl?.name || '').replace(/-(arp|nop)$/, '').trim();
        if (!nm || nm === last) continue;
        last = nm;
        const tick = Math.max(0, Math.round(grid.tickAt(ch.t) / GRID) * GRID);
        const bar = barOf(tick);
        const within = tick - starts[bar];
        if (!cs.some((x) => x.bar === bar && x.tick === within)) cs.push({ bar, tick: within, name: nm, source: 'file' });
      }
      song.chordSymbols = cs;
    }
  });
  if (r.vocals?.length) {
    const v = vocalsTrackFromRs(song, r.vocals, grid, `t${song.tracks.length + 1}`);
    if (v) {
      song.tracks.push(v.track);
      report.vocals = { syllables: v.syllables, lines: v.lines };
    }
  }
  if (r.audioOgg || r.audioWav) {
    song.backing = { name: 'Song audio', path: (r.audioOgg || r.audioWav)!, offsetMs: firstBeatMs, volume: 0.8, mute: false };
  }
  song.rocksmith = {
    title: r.title, artist: r.artist, album: r.album, year: r.year || undefined,
    albumArt: r.albumArt || undefined, previewStartMs: r.previewStart ?? undefined,
    arrangements: song.tracks.filter((t) => t.rocksmith).map((t) => ({ trackId: t.id, type: t.rocksmith!.arrangement })),
    ...(song.tracks.some((t) => t.name === 'Vocals' && !t.rocksmith) ? { vocals: { trackId: song.tracks.find((t) => t.name === 'Vocals' && !t.rocksmith)!.id } } : {}),
    audio: song.backing ? 'file' : 'mix',
    audioFile: song.backing?.path, audioOffsetMs: song.backing?.offsetMs,
  };
  return { song, report };
}

// ================= export =================

export interface RsExportReport {
  track: string;
  type: RsArrangementType;
  singleNotes: number;
  chords: number;
  chordNotes: number;
  chordTemplates: number;
  anchors: number;
  phrases: number;
  sections: string[];
  leadInMs: number;
  songLengthMs: number;
  /** Notes with no string/fret that were placed automatically. */
  placed: number;
}

export interface RsExportOptions {
  type: RsArrangementType;
  bonus?: boolean;
  /** Silence before bar 1 in the exported audio and chart. Default: whole bars, at least 2 s. */
  leadInMs?: number;
  /** Silence after the last bar. Default: one bar. */
  tailMs?: number;
}

/** Can this track be exported to Rocksmith as this arrangement type? Returns a message if not. */
export function rocksmithProblem(t: Track, type: RsArrangementType): string | null {
  if (t.instrument.percussion || !t.tuning) {
    return `"${t.name}" is not a guitar or bass track. Rocksmith 2014 only has 6-string guitar and 4-string bass.`;
  }
  const n = t.tuning.length;
  if (type === 'Bass' && n !== 4) return `"${t.name}" has ${n} strings. Rocksmith 2014 bass arrangements need a 4-string bass.`;
  if (type !== 'Bass' && n !== 6) return `"${t.name}" has ${n} strings. Rocksmith 2014 guitar arrangements need a 6-string guitar.`;
  const std = rsStandard(type, n);
  const offs = t.tuning.map((p, i) => p - std[i]);
  if (offs.some((o) => o < -12 || o > 12)) return `"${t.name}" is tuned more than an octave away from standard; Rocksmith cannot show that.`;
  return null;
}

function rsMask(q: Techniques | undefined): number {
  let m = 0;
  if (!q) return 0;
  if (q.hammerOn) m |= NM.HammerOn;
  if (q.pullOff) m |= NM.PullOff;
  if (q.accent) m |= NM.Accent;
  if (q.harmonic === 'natural' || q.harmonic === 'tap') m |= NM.Harmonic;
  if (q.harmonic === 'pinch' || q.harmonic === 'artificial' || q.harmonic === 'semi') m |= NM.PinchHarmonic;
  if (q.dead) m |= NM.FretHandMute;
  if (q.palmMute) m |= NM.PalmMute;
  if (q.tremolo) m |= NM.Tremolo;
  if (q.slap) m |= NM.Slap;
  if (q.pop) m |= NM.Pluck;
  return m;
}

function fingering(frets: number[]): number[] {
  const fretted = frets.filter((f) => f > 0);
  if (!fretted.length) return frets.map(() => -1);
  const lo = Math.min(...fretted);
  return frets.map((f) => (f > 0 ? Math.min(4, f - lo + 1) : -1));
}

/** Export one track as a Rocksmith arrangement (JSON for the helper). */
export function rocksmithArrangement(song: Song, trackId: string, opts: RsExportOptions): { arrangement: RsArrangement; report: RsExportReport } {
  const t = song.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error(`No track with id ${trackId}`);
  const problem = rocksmithProblem(t, opts.type);
  if (problem) throw new Error(problem);
  const tuning = t.tuning!;
  const std = rsStandard(opts.type, tuning.length);
  const offsets = std.map((p, i) => tuning[i] - p);
  while (offsets.length < 6) offsets.push(0);

  const pts = tempoPoints(song);
  const starts = barStartTicks(song);
  const endTick = songEndTick(song);
  const bar0 = song.bars[0];
  const beatTicks0 = (PPQ * 4) / bar0.timeSignature.denominator;
  const beatMs0 = (beatTicks0 * 60000) / (PPQ * pts[0].bpm);
  const barMs0 = beatMs0 * bar0.timeSignature.numerator;
  const leadBars = opts.leadInMs !== undefined ? 0 : Math.max(1, Math.ceil(2000 / barMs0));
  const leadIn = opts.leadInMs ?? leadBars * barMs0;
  const T = (tick: number) => leadIn + msAtTick(pts, tick);
  const R = (ms: number) => Math.round(ms);

  // ----- beats -----
  const beats: [number, number][] = [];
  let measure = 1;
  if (leadBars) {
    for (let b = 0; b < leadBars; b++) {
      for (let j = 0; j < bar0.timeSignature.numerator; j++) {
        beats.push([R(b * barMs0 + j * beatMs0), j === 0 ? measure++ : -1]);
      }
    }
  } else if (leadIn > 0) {
    // A custom lead-in: one marker at 0 so the chart starts at the audio start.
    beats.push([0, measure++]);
  }
  song.bars.forEach((b, bi) => {
    const step = (PPQ * 4) / b.timeSignature.denominator;
    for (let j = 0; j < b.timeSignature.numerator; j++) beats.push([R(T(starts[bi] + j * step)), j === 0 ? measure++ : -1]);
  });
  // Tail: one more bar of beats at the last tempo, then the closing marker.
  const lastBar = song.bars[song.bars.length - 1];
  const lastBpm = pts[pts.length - 1].bpm;
  const lastStep = (PPQ * 4) / lastBar.timeSignature.denominator;
  const lastBeatMs = (lastStep * 60000) / (PPQ * lastBpm);
  const endMs = T(endTick);
  const tailBeats = lastBar.timeSignature.numerator;
  const tailMs = opts.tailMs ?? tailBeats * lastBeatMs;
  for (let j = 0; j <= tailBeats; j++) {
    const at = endMs + j * lastBeatMs;
    if (at - endMs > tailMs + 1) break;
    beats.push([R(at), j === 0 ? measure++ : -1]);
  }
  const songLength = R(endMs + tailMs);

  // ----- sections + phrases -----
  const rsSecs: { name: string; tick: number }[] = [];
  const own = [...song.sections].sort((a, b) => a.bar - b.bar);
  if (!own.length || own[0].bar > 0) rsSecs.push({ name: own.length ? 'intro' : 'riff', tick: 0 });
  for (const s of own) rsSecs.push({ name: sectionToRs(s.name), tick: starts[s.bar] });
  const counts = new Map<string, number>();
  const sections = rsSecs.map((s) => {
    const n = (counts.get(s.name) ?? 0) + 1;
    counts.set(s.name, n);
    return { name: s.name, t: R(T(s.tick)), n };
  });
  sections.push({ name: 'noguitar', t: R(endMs), n: (counts.get('noguitar') ?? 0) + 1 });
  const phrases: { name: string; maxDifficulty: number }[] = [{ name: 'COUNT', maxDifficulty: 0 }];
  const phraseIterations: [number, number][] = [[0, 0]];
  sections.slice(0, -1).forEach((s) => {
    phrases.push({ name: `${s.name}${s.n}`, maxDifficulty: 0 });
    phraseIterations.push([s.t, phrases.length - 1]);
  });
  phrases.push({ name: 'END', maxDifficulty: 0 });
  phraseIterations.push([R(endMs), phrases.length - 1]);

  // ----- notes and chords -----
  const events = trackEvents(song, t);
  let placed = 0;
  // Group by start; give every note a string/fret.
  const groups: { start: number; ev: NoteEvent[] }[] = [];
  for (const e of events) {
    const g = groups[groups.length - 1];
    if (g && g.start === e.start) g.ev.push(e);
    else groups.push({ start: e.start, ev: [e] });
  }
  for (const g of groups) {
    // One note per string per moment: extra notes on a taken string are dropped.
    const missing = g.ev.filter((e) => e.string === undefined || e.fret === undefined);
    if (missing.length) {
      const pos = assignChord(g.ev.map((e) => e.pitch), tuning, { capo: t.capo ?? 0 });
      g.ev.forEach((e, i) => {
        if ((e.string === undefined || e.fret === undefined) && pos[i]) {
          e.string = pos[i]!.string;
          e.fret = pos[i]!.fret;
          placed++;
        }
      });
    }
    const seen = new Set<number>();
    g.ev = g.ev.filter((e) => {
      if (e.string === undefined || e.fret === undefined || seen.has(e.string)) return false;
      seen.add(e.string);
      return true;
    });
  }
  const allGroups = groups.filter((g) => g.ev.length);
  // Next event on each string (for slides) and next onset (for chord shapes).
  const flat = allGroups.flatMap((g) => g.ev);
  const nextOnString = new Map<NoteEvent, NoteEvent>();
  const lastOn = new Map<number, NoteEvent>();
  for (let i = flat.length - 1; i >= 0; i--) {
    const e = flat[i];
    const nx = lastOn.get(e.string!);
    if (nx) nextOnString.set(e, nx);
    lastOn.set(e.string!, e);
  }

  const toRsNote = (e: NoteEvent): RsNote => {
    const q = e.techniques;
    const t0 = T(e.start);
    const tEnd = T(e.start + e.dur);
    const needsSus = !!(q?.bend?.length || q?.slideOut || q?.vibrato || q?.tremolo);
    let sus = needsSus || e.dur >= PPQ ? R(tEnd - t0) : 0;
    let mask = rsMask(q);
    let slideTo = -1;
    let slideUnpitchTo = -1;
    if (q?.slideOut === 'shift' || q?.slideOut === 'legato') {
      const nx = nextOnString.get(e);
      if (q.slideToFret !== undefined) slideTo = q.slideToFret;
      else if (nx && nx.fret !== e.fret) slideTo = nx.fret!;
      else slideTo = Math.min(24, Math.max(1, e.fret! + (e.fret! >= 22 ? -2 : 2)));
      if (q.slideOut === 'legato' && nx && nx.fret === slideTo && q.slideToFret === undefined) {
        mask |= NM.LinkNext;
        sus = Math.max(1, R(T(nx.start) - t0));
      }
    } else if (q?.slideOut === 'outUp') slideUnpitchTo = Math.min(24, e.fret! + 4);
    else if (q?.slideOut === 'outDown') slideUnpitchTo = Math.max(1, e.fret! - 4);
    const bends: [number, number][] = [];
    if (q?.bend?.length && sus > 0) {
      for (const p of q.bend) {
        if (p.position === 0 && p.value === 0) continue;
        bends.push([R(t0 + (p.position / 60) * sus), Math.round((p.value / 4) * 1000) / 1000]);
      }
      // Drop repeated holds at the same value (keep the first of a run).
      for (let i = bends.length - 1; i > 0; i--) if (bends[i][1] === bends[i - 1][1]) bends.splice(i, 1);
    }
    return {
      t: R(t0), s: e.string! - 1, f: e.fret!, sus, mask, slideTo, slideUnpitchTo,
      tap: q?.tap ? 1 : 0, vib: q?.vibrato ? 80 : 0, lh: -1, bends,
    };
  };

  const chordAt = (tick: number): string => {
    let name = '';
    for (const cs of song.chordSymbols) {
      const at = starts[cs.bar] + cs.tick;
      if (at <= tick) name = cs.name;
      else break;
    }
    return name;
  };

  const notes: RsNote[] = [];
  const chords: RsChord[] = [];
  const templates: RsChordTemplate[] = [];
  const templateIds = new Map<string, number>();
  const handShapes: [number, number, number][] = [];
  let chordNotes = 0;
  allGroups.forEach((g, gi) => {
    const nextStart = allGroups[gi + 1]?.start;
    if (g.ev.length === 1) {
      notes.push(toRsNote(g.ev[0]));
      return;
    }
    const frets = [-1, -1, -1, -1, -1, -1];
    for (const e of g.ev) frets[e.string! - 1] = e.fret!;
    const name = chordAt(g.start);
    const key = frets.join(',') + '|' + name;
    let id = templateIds.get(key);
    if (id === undefined) {
      id = templates.length;
      templateIds.set(key, id);
      templates.push({ name, displayName: name, frets, fingers: fingering(frets) });
    }
    const cn = g.ev.map(toRsNote).sort((a, b) => a.s - b.s);
    chordNotes += cn.length;
    let cmask = 0;
    if (g.ev.every((e) => e.techniques?.palmMute)) cmask |= CM.PalmMute;
    if (g.ev.every((e) => e.techniques?.dead)) cmask |= CM.FretHandMute;
    if (g.ev.some((e) => e.techniques?.accent)) cmask |= CM.Accent;
    const ct = R(T(g.start));
    chords.push({ t: ct, id, mask: cmask, notes: cn });
    const sus = Math.max(...cn.map((n) => n.sus));
    const gap = nextStart !== undefined ? R(T(nextStart)) - ct : R(T(g.start + PPQ)) - ct;
    const end = ct + Math.max(1, Math.min(gap - 1, Math.max(sus, Math.min(gap - 1, R(beatMs0)))));
    handShapes.push([id, ct, end]);
  });
  notes.sort((a, b) => a.t - b.t || a.s - b.s);

  // ----- anchors (hand positions) -----
  const anchors: [number, number, number][] = [];
  type Ev = { t: number; frets: number[] };
  const evs: Ev[] = [
    ...notes.map((n) => ({ t: n.t, frets: [n.f] })),
    ...chords.map((c) => ({ t: c.t, frets: c.notes.map((n) => n.f) })),
  ].sort((a, b) => a.t - b.t);
  const phraseStarts = phraseIterations.slice(1, -1).map((p) => p[0]);
  let cur = { fret: 1, width: 4 };
  let pi = 0;
  const firstFretted = evs.find((e) => e.frets.some((f) => f > 0));
  if (firstFretted) {
    const fs = firstFretted.frets.filter((f) => f > 0);
    cur = { fret: Math.max(1, Math.min(...fs)), width: 4 };
  }
  anchors.push([beats[0][0], cur.fret, cur.width]);
  for (const e of evs) {
    let forced = false;
    while (pi < phraseStarts.length && phraseStarts[pi] <= e.t) {
      pi++;
      forced = true;
    }
    const fs = e.frets.filter((f) => f > 0);
    let next = cur;
    if (fs.length) {
      const lo = Math.min(...fs);
      const hi = Math.max(...fs);
      if (lo < cur.fret || hi > cur.fret + cur.width - 1) {
        if (hi - lo < 4) next = { fret: lo < cur.fret ? lo : Math.max(1, hi - 3), width: 4 };
        else next = { fret: lo, width: Math.min(7, hi - lo + 1) };
      }
    }
    if (forced) {
      anchors.push([phraseStarts[pi - 1], next.fret, next.width]);
      cur = next;
      continue;
    }
    if (next !== cur) {
      anchors.push([e.t, next.fret, next.width]);
      cur = next;
    }
  }
  // Keep one anchor per time (the last).
  const byTime = new Map<number, [number, number, number]>();
  for (const a of anchors) byTime.set(a[0], a);
  const anchorList = [...byTime.values()].sort((a, b) => a[0] - b[0]);

  const bpms = pts.map((p) => p.bpm);
  const arrangement: RsArrangement = {
    name: opts.type,
    priority: opts.bonus ? 'Bonus' : 'Main',
    tuning: offsets,
    capo: t.capo ?? 0,
    centOffset: t.rocksmith?.centOffset ?? 0,
    songLength,
    averageTempo: Math.round((bpms.reduce((a, b) => a + b, 0) / bpms.length) * 1000) / 1000,
    pathBass: opts.type === 'Bass',
    pathLead: opts.type === 'Lead',
    pathRhythm: opts.type === 'Rhythm',
    bassPick: opts.type === 'Bass' && t.instrument.id === 'picked-bass',
    bassPicked: opts.type === 'Bass' && t.instrument.id === 'picked-bass',
    beats,
    phrases,
    phraseIterations,
    sections,
    chordTemplates: templates,
    notes,
    chords,
    anchors: anchorList,
    handShapes,
  };
  return {
    arrangement,
    report: {
      track: t.name, type: opts.type, singleNotes: notes.length, chords: chords.length, chordNotes,
      chordTemplates: templates.length, anchors: anchorList.length, phrases: phrases.length,
      sections: sections.map((s) => s.name), leadInMs: R(leadIn), songLengthMs: songLength, placed,
    },
  };
}

/** Count of notes as the game sees them (single notes + every note of every chord). */
export function rsNoteCount(a: RsArrangement): number {
  return a.notes.length + a.chords.reduce((n, c) => n + (c.notes?.length || a.chordTemplates[c.id]?.frets.filter((f) => f >= 0).length || 0), 0);
}
