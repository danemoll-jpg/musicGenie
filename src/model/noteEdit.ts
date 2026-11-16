// Note-by-note editing: pure Song -> Song functions driven by a cursor (track/staff/bar/voice/beat/string).
// Every edit returns a NEW song; the input is never mutated. Bars always stay exactly full:
// an edit that makes a voice too short gets rests added, too long loses beats from the end.
import { cloneSong } from './edits';
import { assignChord, MAX_FRET, positionsFor } from './fretting';
import { barTicks, durationTicks, splitTicks } from './timing';
import type { BarHeader, Beat, BendPoint, Duration, DurationBase, Measure, Note, Song, Techniques, Track, Voice } from './types';

export interface Cursor {
  track: number;
  staff: number;
  bar: number;
  voice: number;
  /** Beat index in the voice (grace beats count). */
  beat: number;
  /** 1-based string (1 = lowest). Only meaningful on fretted tracks. */
  string: number;
}

export const DEFAULT_VELOCITY = 96;
export const DURATION_BASES: DurationBase[] = [1, 2, 4, 8, 16, 32, 64];

// ---------- addressing ----------

export function trackAt(song: Song, c: Cursor): Track {
  const t = song.tracks[c.track];
  if (!t) throw new Error(`No track ${c.track}`);
  return t;
}

export function voiceAt(song: Song, c: Cursor): Voice {
  const v = trackAt(song, c).staves[c.staff]?.measures[c.bar]?.voices[c.voice];
  if (!v) throw new Error(`No voice at bar ${c.bar + 1}`);
  return v;
}

export function beatAt(song: Song, c: Cursor): Beat | undefined {
  return voiceAt(song, c).beats[c.beat];
}

export function isFretted(t: Track): boolean {
  return !!t.tuning && !t.instrument.percussion;
}

function restsFor(ticks: number, prefer?: Duration): Beat[] {
  if (ticks <= 0) return [];
  if (prefer && !prefer.tuplet) {
    const d = durationTicks(prefer);
    if (d > 0 && ticks % d === 0 && ticks / d <= 16) {
      return Array.from({ length: ticks / d }, () => ({ duration: { ...prefer }, notes: [] }));
    }
  }
  return splitTicks(ticks).map((d) => ({ duration: d, notes: [] }));
}

/** A measure of whole-bar rests (one voice). */
export function restMeasure(bar: BarHeader): Measure {
  return { voices: [{ beats: restsFor(barTicks(bar)) }] };
}

const len = (beats: Beat[]) => beats.reduce((a, b) => a + (b.grace ? 0 : durationTicks(b.duration)), 0);

/**
 * Make a voice exactly one bar long. `keep` = index of the beat that was just edited: beats after
 * it are dropped first when too long; rests in that beat's duration fill when too short.
 */
export function fitVoice(beats: Beat[], barLen: number, keep = -1): Beat[] {
  const out = [...beats];
  let total = len(out);
  while (total > barLen && out.length > keep + 1 && out.length > 1) {
    const b = out.pop()!;
    total -= b.grace ? 0 : durationTicks(b.duration);
  }
  if (total > barLen && out.length) {
    // The kept beat itself is too long: shorten it to what is left.
    const last = out[out.length - 1];
    const room = barLen - (total - durationTicks(last.duration));
    const fit = splitTicks(Math.max(0, room))[0];
    if (fit) last.duration = fit;
    else out.pop();
    total = len(out);
  }
  if (total < barLen) out.push(...restsFor(barLen - total, keep >= 0 ? out[keep]?.duration : undefined));
  return out;
}

/** Clone the song and run `fn` on the cursor's voice (filled with rests first if empty). */
export function editVoice(song: Song, c: Cursor, fn: (beats: Beat[], track: Track, bar: BarHeader) => number | void): Song {
  const next = cloneSong(song);
  const t = trackAt(next, c);
  const bar = next.bars[c.bar];
  const v = t.staves[c.staff].measures[c.bar].voices[c.voice];
  if (!v.beats.length) v.beats = restsFor(barTicks(bar));
  const keep = fn(v.beats, t, bar);
  v.beats = fitVoice(v.beats, barTicks(bar), typeof keep === 'number' ? keep : c.beat);
  return next;
}

/** The cursor clamped to the song (after edits that remove beats or bars). */
export function clampCursor(song: Song, c: Cursor): Cursor {
  const track = Math.max(0, Math.min(song.tracks.length - 1, c.track));
  const t = song.tracks[track];
  const staff = Math.max(0, Math.min(t.staves.length - 1, c.staff));
  const bar = Math.max(0, Math.min(song.bars.length - 1, c.bar));
  const m = t.staves[staff].measures[bar];
  const voice = Math.max(0, Math.min(m.voices.length - 1, c.voice));
  const beats = m.voices[voice].beats.length;
  const beat = Math.max(0, Math.min(Math.max(0, beats - 1), c.beat));
  const strings = t.tuning?.length ?? 1;
  return { track, staff, bar, voice, beat, string: Math.max(1, Math.min(strings, c.string)) };
}

// ---------- cursor movement ----------

/** Move left/right by beats (crossing bars) or up/down by strings (1 = lowest string). */
export function moveCursor(song: Song, c: Cursor, dir: 'left' | 'right' | 'up' | 'down'): Cursor {
  const t = trackAt(song, c);
  if (dir === 'up' || dir === 'down') {
    const n = t.tuning?.length ?? 1;
    // "Up" on screen is a higher string: tab draws the highest string at the top.
    const s = dir === 'up' ? c.string + 1 : c.string - 1;
    return { ...c, string: Math.max(1, Math.min(n, s)) };
  }
  const beats = (bar: number) => Math.max(1, t.staves[c.staff].measures[bar]?.voices[c.voice]?.beats.length ?? 1);
  if (dir === 'right') {
    if (c.beat + 1 < beats(c.bar)) return { ...c, beat: c.beat + 1 };
    if (c.bar + 1 < song.bars.length) return { ...c, bar: c.bar + 1, beat: 0 };
    return c;
  }
  if (c.beat > 0) return { ...c, beat: c.beat - 1 };
  if (c.bar > 0) return { ...c, bar: c.bar - 1, beat: beats(c.bar - 1) - 1 };
  return c;
}

// ---------- notes ----------

/** Put a fret on the cursor's string (replacing any note on that string). */
export function setFret(song: Song, c: Cursor, fret: number): Song {
  const t = trackAt(song, c);
  if (!isFretted(t)) throw new Error('This track has no strings: switch it to a guitar or bass to type frets.');
  const tuning = t.tuning!;
  const capo = t.capo ?? 0;
  let f = Math.max(0, Math.min(MAX_FRET, Math.round(fret)));
  if (capo && f < capo) f += capo; // "0" on a capoed string = the capo fret
  f = Math.min(MAX_FRET, f);
  const open = tuning[c.string - 1];
  if (open === undefined) throw new Error(`String ${c.string} does not exist on this track.`);
  return editVoice(song, c, (beats) => {
    const b = beats[c.beat];
    const existing = b.notes.find((n) => n.string === c.string);
    if (existing) {
      existing.fret = f;
      existing.pitch = open + f;
      delete existing.tieFromPrevious;
    } else {
      b.notes.push({ pitch: open + f, velocity: DEFAULT_VELOCITY, string: c.string, fret: f });
      b.notes.sort((x, y) => (x.string ?? 0) - (y.string ?? 0));
    }
  });
}

/** Remove the note on the cursor's string; with `wholeBeat` (or on non-fretted tracks), turn the beat into a rest. */
export function deleteNote(song: Song, c: Cursor, wholeBeat = false): Song {
  return editVoice(song, c, (beats, t) => {
    const b = beats[c.beat];
    if (!b) return;
    if (wholeBeat || !isFretted(t)) b.notes = [];
    else b.notes = b.notes.filter((n) => n.string !== c.string);
  });
}

export function makeRest(song: Song, c: Cursor): Song {
  return deleteNote(song, c, true);
}

export function setDuration(song: Song, c: Cursor, d: Duration): Song {
  return editVoice(song, c, (beats) => {
    const b = beats[c.beat];
    if (b) b.duration = { ...d, tuplet: d.tuplet ? { ...d.tuplet } : undefined };
    if (b && !b.duration.tuplet) delete b.duration.tuplet;
  });
}

/** One step shorter (+1) or longer (-1): quarter -> eighth is "shorter". */
export function stepDuration(song: Song, c: Cursor, step: 1 | -1): Song {
  const b = beatAt(song, c);
  if (!b) return song;
  const i = DURATION_BASES.indexOf(b.duration.base) + step;
  if (i < 0 || i >= DURATION_BASES.length) return song;
  return setDuration(song, c, { ...b.duration, base: DURATION_BASES[i] });
}

export function toggleDot(song: Song, c: Cursor): Song {
  const b = beatAt(song, c);
  if (!b) return song;
  return setDuration(song, c, { ...b.duration, dots: b.duration.dots ? 0 : 1 });
}

/** Triplet on/off. Turning it on makes this beat and the next two (same length) one triplet group. */
export function toggleTriplet(song: Song, c: Cursor): Song {
  return editVoice(song, c, (beats) => {
    const b = beats[c.beat];
    if (!b) return;
    if (b.duration.tuplet) {
      for (const x of beats) if (x.duration.tuplet && x.duration.base === b.duration.base) delete x.duration.tuplet;
      return;
    }
    // Three triplet beats take the time of two plain ones: replace the beat (and the next, if it
    // matches) with three triplet beats; the bar is refitted afterwards.
    const base = b.duration.base;
    const group: Beat[] = [b];
    for (let k = 1; k < 3; k++) {
      const nb = beats[c.beat + k];
      if (nb && !nb.grace && nb.duration.base === base && !nb.duration.tuplet && !nb.duration.dots) group.push(nb);
      else break;
    }
    const plainTicks = durationTicks({ base, dots: 0 });
    const groupTicks = plainTicks * 2;
    let consumed = 0;
    let n = 0;
    for (const g of group) {
      if (consumed >= groupTicks) break;
      consumed += durationTicks(g.duration);
      n++;
    }
    const tripletBeats: Beat[] = [];
    for (let k = 0; k < 3; k++) {
      const src = group[k];
      tripletBeats.push({ duration: { base, dots: 0, tuplet: { num: 3, den: 2 } }, notes: src && k < n ? src.notes : [] });
    }
    beats.splice(c.beat, n, ...tripletBeats);
    // If we took less than the group's length, the refit pads with rests.
    return c.beat + 2;
  });
}

/** Tie the beat's notes to the same pitches in the previous beat (or untie). */
export function toggleTie(song: Song, c: Cursor): Song {
  const b = beatAt(song, c);
  if (!b?.notes.length) return song;
  const tied = b.notes.every((n) => n.tieFromPrevious);
  return editVoice(song, c, (beats) => {
    for (const n of beats[c.beat].notes) {
      if (tied) delete n.tieFromPrevious;
      else n.tieFromPrevious = true;
    }
  });
}

/** Insert a rest before the cursor beat (same length as it). */
export function insertBeat(song: Song, c: Cursor): Song {
  return editVoice(song, c, (beats) => {
    const ref = beats[c.beat] ?? beats[beats.length - 1];
    beats.splice(c.beat, 0, { duration: { ...ref.duration }, notes: [] });
    return c.beat;
  });
}

/** Remove the cursor beat; the bar is filled up with rests at the end. */
export function deleteBeat(song: Song, c: Cursor): Song {
  return editVoice(song, c, (beats) => {
    beats.splice(c.beat, 1);
    return Math.max(0, c.beat - 1);
  });
}

// ---------- staff entry ----------

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Pitch class of a letter in a key (G major: F -> F#). */
export function letterPitchClass(letter: string, fifths: number): number {
  const L = letter.toUpperCase();
  let pc = LETTER_PC[L];
  if (pc === undefined) throw new Error(`Not a note letter: ${letter}`);
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(L)) pc += 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(L)) pc -= 1;
  return (pc + 12) % 12;
}

/** The last sounding pitch at or before the cursor in this voice (searching back through bars). */
function previousPitch(song: Song, c: Cursor): { pitch: number; fret?: number } | null {
  const t = trackAt(song, c);
  const measures = t.staves[c.staff].measures;
  for (let bar = c.bar; bar >= 0; bar--) {
    const beats = measures[bar].voices[c.voice]?.beats ?? [];
    const from = bar === c.bar ? Math.min(c.beat - 1, beats.length - 1) : beats.length - 1;
    for (let i = from; i >= 0; i--) {
      const ns = beats[i].notes;
      if (ns.length) {
        const top = ns[ns.length - 1];
        return { pitch: top.pitch, fret: top.fret };
      }
    }
  }
  return null;
}

function defaultPitch(t: Track, clef: string): number {
  if (t.tuning) return t.tuning[Math.floor(t.tuning.length / 2)] + 2;
  return clef === 'bass' ? 48 : 67;
}

function nearestWithPc(pc: number, ref: number): number {
  let best = ref;
  let bestD = Infinity;
  for (let p = ref - 6; p <= ref + 6; p++) {
    if (((p % 12) + 12) % 12 === pc && Math.abs(p - ref) < bestD) {
      best = p;
      bestD = Math.abs(p - ref);
    }
  }
  return best;
}

/** Place pitches on strings for a fretted track, near `aroundFret`. Notes that cannot be placed lose string/fret. */
export function placeOnStrings(notes: Note[], t: Track, aroundFret: number) {
  if (!isFretted(t)) return;
  const pos = assignChord(notes.map((n) => n.pitch), t.tuning!, { capo: t.capo ?? 0, aroundFret });
  notes.forEach((n, i) => {
    if (pos[i]) {
      n.string = pos[i]!.string;
      n.fret = pos[i]!.fret;
    } else {
      delete n.string;
      delete n.fret;
    }
  });
}

/**
 * Staff entry: letter A-G gives the nearest such pitch (in the bar's key) to the previous note.
 * `addToChord` adds it to the beat instead of replacing the beat's notes.
 */
export function enterLetter(song: Song, c: Cursor, letter: string, addToChord = false): Song {
  const t = trackAt(song, c);
  const pc = letterPitchClass(letter, song.bars[c.bar].key.fifths);
  const prev = previousPitch(song, c);
  const ref = prev?.pitch ?? defaultPitch(t, t.staves[c.staff].clef);
  let pitch = nearestWithPc(pc, ref);
  if (isFretted(t)) {
    const low = t.tuning![0] + (t.capo ?? 0);
    const high = t.tuning![t.tuning!.length - 1] + MAX_FRET;
    while (pitch < low) pitch += 12;
    while (pitch > high) pitch -= 12;
  }
  return editVoice(song, c, (beats, tr) => {
    const b = beats[c.beat];
    const note: Note = { pitch, velocity: DEFAULT_VELOCITY };
    if (addToChord && b.notes.length) {
      if (!b.notes.some((n) => n.pitch === pitch)) b.notes.push(note);
      b.notes.sort((x, y) => x.pitch - y.pitch);
    } else {
      b.notes = [note];
    }
    placeOnStrings(b.notes, tr, prev?.fret ?? 3);
  });
}

/** Indices of the notes an edit applies to: the note on the cursor string, else every note of the beat. */
function targetNotes(b: Beat, t: Track, c: Cursor, wholeBeat: boolean): Note[] {
  if (!wholeBeat && isFretted(t)) {
    const on = b.notes.filter((n) => n.string === c.string);
    if (on.length) return on;
  }
  return b.notes;
}

/** Raise/lower the target notes by semitones. Fretted notes stay on their string when they can. */
export function shiftPitch(song: Song, c: Cursor, semitones: number, wholeBeat = false): Song {
  const b = beatAt(song, c);
  if (!b?.notes.length) return song;
  return editVoice(song, c, (beats, t) => {
    const beat = beats[c.beat];
    const targets = targetNotes(beat, t, c, wholeBeat);
    for (const n of targets) {
      n.pitch = Math.max(0, Math.min(127, n.pitch + semitones));
      delete n.tieFromPrevious;
      if (!isFretted(t) || n.string === undefined) continue;
      const open = t.tuning![n.string - 1];
      const f = n.pitch - open;
      if (f >= (t.capo ?? 0) && f <= MAX_FRET) {
        n.fret = f;
        continue;
      }
      const used = new Set(beat.notes.filter((x) => x !== n).map((x) => x.string));
      const options = positionsFor(n.pitch, t.tuning!, t.capo ?? 0).filter((p) => !used.has(p.string));
      options.sort((a, b2) => Math.abs(a.fret - (n.fret ?? 0)) - Math.abs(b2.fret - (n.fret ?? 0)));
      if (options[0]) {
        n.string = options[0].string;
        n.fret = options[0].fret;
      } else {
        delete n.string;
        delete n.fret;
      }
    }
  });
}

// ---------- techniques ----------

export type TechniqueId =
  | 'hopo' | 'hammerOn' | 'pullOff' | 'slide' | 'slideLegato' | 'slideOutUp' | 'slideOutDown'
  | 'bendHalf' | 'bendFull' | 'bendFullHalf' | 'bendRelease' | 'vibrato' | 'palmMute' | 'dead'
  | 'harmonic' | 'pinchHarmonic' | 'tap' | 'slap' | 'pop' | 'accent' | 'tremolo';

export const BEND_SHAPES: Record<'bendHalf' | 'bendFull' | 'bendFullHalf' | 'bendRelease', BendPoint[]> = {
  bendHalf: [{ position: 0, value: 0 }, { position: 20, value: 2 }, { position: 60, value: 2 }],
  bendFull: [{ position: 0, value: 0 }, { position: 20, value: 4 }, { position: 60, value: 4 }],
  bendFullHalf: [{ position: 0, value: 0 }, { position: 20, value: 6 }, { position: 60, value: 6 }],
  bendRelease: [{ position: 0, value: 0 }, { position: 15, value: 4 }, { position: 40, value: 4 }, { position: 60, value: 0 }],
};

/** Does the note have this technique? */
export function hasTechnique(n: Note, id: TechniqueId): boolean {
  const q = n.techniques ?? {};
  switch (id) {
    case 'hopo': return !!(q.hammerOn || q.pullOff);
    case 'hammerOn': return !!q.hammerOn;
    case 'pullOff': return !!q.pullOff;
    case 'slide': return q.slideOut === 'shift';
    case 'slideLegato': return q.slideOut === 'legato';
    case 'slideOutUp': return q.slideOut === 'outUp';
    case 'slideOutDown': return q.slideOut === 'outDown';
    case 'bendHalf': case 'bendFull': case 'bendFullHalf': case 'bendRelease':
      return JSON.stringify(q.bend ?? null) === JSON.stringify(BEND_SHAPES[id]);
    case 'vibrato': return !!q.vibrato;
    case 'palmMute': return !!q.palmMute;
    case 'dead': return !!q.dead;
    case 'harmonic': return q.harmonic === 'natural';
    case 'pinchHarmonic': return q.harmonic === 'pinch';
    case 'tap': return !!q.tap;
    case 'slap': return !!q.slap;
    case 'pop': return !!q.pop;
    case 'accent': return !!q.accent;
    case 'tremolo': return !!q.tremolo;
  }
}

function previousOnString(beats: Beat[], index: number, s: number | undefined): Note | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const n = beats[i].notes.find((x) => (s === undefined ? true : x.string === s));
    if (n) return n;
  }
  return undefined;
}

function applyTechnique(n: Note, id: TechniqueId, on: boolean, prev: Note | undefined) {
  const q: Techniques = n.techniques ?? {};
  const set = <K extends keyof Techniques>(k: K, v: Techniques[K]) => {
    if (on) q[k] = v;
    else delete q[k];
  };
  switch (id) {
    case 'hopo':
      delete q.hammerOn;
      delete q.pullOff;
      if (on) {
        if (prev && prev.pitch > n.pitch) q.pullOff = true;
        else q.hammerOn = true;
      }
      break;
    case 'hammerOn': delete q.pullOff; set('hammerOn', true); break;
    case 'pullOff': delete q.hammerOn; set('pullOff', true); break;
    case 'slide': set('slideOut', 'shift'); if (!on) delete q.slideToFret; break;
    case 'slideLegato': set('slideOut', 'legato'); if (!on) delete q.slideToFret; break;
    case 'slideOutUp': set('slideOut', 'outUp'); break;
    case 'slideOutDown': set('slideOut', 'outDown'); break;
    case 'bendHalf': case 'bendFull': case 'bendFullHalf': case 'bendRelease':
      set('bend', structuredClone(BEND_SHAPES[id]));
      break;
    case 'vibrato': set('vibrato', 'slight'); break;
    case 'palmMute': set('palmMute', true); break;
    case 'dead': set('dead', true); break;
    case 'harmonic': set('harmonic', 'natural'); break;
    case 'pinchHarmonic': set('harmonic', 'pinch'); break;
    case 'tap': set('tap', true); break;
    case 'slap': delete q.pop; set('slap', true); break;
    case 'pop': delete q.slap; set('pop', true); break;
    case 'accent': set('accent', 'normal'); break;
    case 'tremolo': set('tremolo', true); break;
  }
  if (Object.keys(q).length) n.techniques = q;
  else delete n.techniques;
}

/** Toggle a technique on the cursor's note (or every note of the beat). On if any target lacks it. */
export function toggleTechnique(song: Song, c: Cursor, id: TechniqueId, wholeBeat = false): Song {
  const b = beatAt(song, c);
  if (!b?.notes.length) return song;
  const t = trackAt(song, c);
  const targets = targetNotes(b, t, c, wholeBeat);
  const on = !targets.every((n) => hasTechnique(n, id));
  return editVoice(song, c, (beats, tr) => {
    const beat = beats[c.beat];
    for (const n of targetNotes(beat, tr, c, wholeBeat)) {
      applyTechnique(n, id, on, previousOnString(beats, c.beat, n.string));
    }
  });
}

// ---------- copy / paste ----------

export type Clip =
  | { kind: 'beats'; beats: Beat[] }
  | { kind: 'bars'; staves: Measure[][]; bars: BarHeader[] };

export function copyBeat(song: Song, c: Cursor): Clip | null {
  const b = beatAt(song, c);
  return b ? { kind: 'beats', beats: [structuredClone(b)] } : null;
}

/** Copy bars [from, to] of the cursor's track (every staff). */
export function copyBars(song: Song, c: Cursor, from: number, to: number): Clip {
  const t = trackAt(song, c);
  return {
    kind: 'bars',
    staves: t.staves.map((s) => structuredClone(s.measures.slice(from, to + 1))),
    bars: structuredClone(song.bars.slice(from, to + 1)),
  };
}

/** Make copied notes fit the target track: keep string/fret if valid there, else re-place. */
function adaptNotes(notes: Note[], t: Track) {
  if (!isFretted(t)) {
    for (const n of notes) {
      delete n.string;
      delete n.fret;
    }
    return;
  }
  const ok = notes.every((n) => n.string !== undefined && t.tuning![n.string - 1] !== undefined &&
    n.pitch - t.tuning![n.string - 1] === n.fret);
  if (!ok) placeOnStrings(notes, t, 3);
}

/** Paste at the cursor. Beats replace the cursor beat onwards; bars replace bars from the cursor bar (adding bars at the end if needed). */
export function paste(song: Song, c: Cursor, clip: Clip): Song {
  if (clip.kind === 'beats') {
    return editVoice(song, c, (beats, t) => {
      const copies = structuredClone(clip.beats);
      for (const b of copies) adaptNotes(b.notes, t);
      // Replace as many following beats as the pasted ones cover.
      const need = len(copies);
      let have = 0;
      let k = c.beat;
      while (k < beats.length && have < need) {
        have += beats[k].grace ? 0 : durationTicks(beats[k].duration);
        k++;
      }
      beats.splice(c.beat, k - c.beat, ...copies);
      if (have > need) beats.splice(c.beat + copies.length, 0, ...restsFor(have - need));
      return c.beat + copies.length - 1;
    });
  }
  let next = song;
  const lastBar = c.bar + clip.bars.length - 1;
  while (next.bars.length - 1 < lastBar) next = insertBars(next, next.bars.length, 1);
  next = cloneSong(next);
  const t = next.tracks[c.track];
  clip.bars.forEach((_, i) => {
    const bar = c.bar + i;
    const barLen = barTicks(next.bars[bar]);
    t.staves.forEach((s, si) => {
      const src = clip.staves[si]?.[i] ?? clip.staves[0]?.[i];
      const m: Measure = src ? structuredClone(src) : restMeasure(next.bars[bar]);
      for (const v of m.voices) {
        for (const b of v.beats) adaptNotes(b.notes, t);
        v.beats = fitVoice(v.beats, barLen);
      }
      s.measures[bar] = m;
    });
  });
  return next;
}

// ---------- bars ----------

/** Insert `count` empty bars before bar `at` (at = bars.length appends). Copies the time/key of the neighbour. */
export function insertBars(song: Song, at: number, count = 1): Song {
  const next = cloneSong(song);
  const ref = next.bars[Math.min(at, next.bars.length - 1)] ?? { timeSignature: { numerator: 4, denominator: 4 }, key: { fifths: 0, mode: 'major' } };
  const headers: BarHeader[] = Array.from({ length: count }, () => ({
    timeSignature: { ...ref.timeSignature }, key: { ...ref.key },
  }));
  next.bars.splice(at, 0, ...headers);
  for (const t of next.tracks) {
    for (const s of t.staves) {
      const voices = Math.max(1, ...s.measures.map((m) => m.voices.length));
      const fresh = headers.map((h) => {
        const m = restMeasure(h);
        while (m.voices.length < voices) m.voices.push({ beats: [] });
        return m;
      });
      s.measures.splice(at, 0, ...fresh);
    }
  }
  const shift = (bar: number) => (bar >= at ? bar + count : bar);
  next.sections = next.sections.map((x) => ({ ...x, bar: at === 0 && x.bar === 0 ? 0 : shift(x.bar) }));
  next.chordSymbols = next.chordSymbols.map((x) => ({ ...x, bar: shift(x.bar) }));
  next.tempos = next.tempos.map((x) => (x.bar === 0 && x.tick === 0 ? x : { ...x, bar: shift(x.bar) }));
  return next;
}

/** Delete bars [from, to] (inclusive). At least one bar always remains. */
export function deleteBars(song: Song, from: number, to: number): Song {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(song.bars.length - 1, Math.max(from, to));
  const count = b - a + 1;
  if (count >= song.bars.length) throw new Error('A song needs at least one bar.');
  const next = cloneSong(song);
  next.bars.splice(a, count);
  for (const t of next.tracks) for (const s of t.staves) s.measures.splice(a, count);
  const map = (bar: number) => (bar > b ? bar - count : bar);
  // A section starting inside the deleted bars moves to the first bar after them (unless one starts there).
  const secs = new Map<number, string>();
  for (const x of next.sections) {
    const nb = x.bar >= a && x.bar <= b ? a : map(x.bar);
    if (nb < next.bars.length && (!secs.has(nb) || !(x.bar >= a && x.bar <= b))) secs.set(nb, x.name);
  }
  next.sections = [...secs].map(([bar, name]) => ({ bar, name })).sort((x, y) => x.bar - y.bar);
  next.chordSymbols = next.chordSymbols.filter((x) => x.bar < a || x.bar > b).map((x) => ({ ...x, bar: map(x.bar) }));
  // Keep the tempo that was in force at the end of the deleted range.
  const inRange = next.tempos.filter((x) => x.bar >= a && x.bar <= b);
  const last = inRange[inRange.length - 1];
  next.tempos = next.tempos.filter((x) => x.bar < a || x.bar > b).map((x) => ({ ...x, bar: map(x.bar) }));
  if (last && !next.tempos.some((x) => x.bar === a && x.tick === 0) && a < next.bars.length) {
    next.tempos.push({ bar: a, tick: 0, bpm: last.bpm });
  }
  if (!next.tempos.some((x) => x.bar === 0 && x.tick === 0)) next.tempos.unshift({ bar: 0, tick: 0, bpm: song.tempos[0]?.bpm ?? 120 });
  next.tempos.sort((x, y) => x.bar - y.bar || x.tick - y.tick);
  return next;
}
