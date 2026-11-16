// Virtual band v1: five styles, four roles (drums, bass, rhythm guitar/keys, lead).
// Pure and deterministic: same song + settings + seed = same notes.
import {
  chordAt, chordTones, detectChords, harmonySourceTracks, parseChord, QUALITIES, type ChordInfo, type Quality,
} from './chords';
import { buildMeasures, hashOf, trackEvents, type NoteEvent } from './events';
import { assignChord, positionsFor } from './fretting';
import { findInstrument, toInstrumentRef } from './instruments';
import { sectionRanges, type SectionRange } from './sections';
import { extractPart } from './split';
import { barStartTicks, barTicks } from './timing';
import type {
  BandRole, BandSettings, Complexity, GeneratedTag, Measure, PlayerSetup, Song, Staff, StyleId, Track,
} from './types';

// ---------------- styles ----------------

export interface StyleDef {
  id: StyleId;
  name: string;
  /** Playback swing set on Generate (0 straight .. 1 triplet). */
  swing: number;
  blurb: string;
  instruments: Record<BandRole, string>;
}

export const STYLES: Record<StyleId, StyleDef> = {
  rock: {
    id: 'rock', name: 'Rock', swing: 0, blurb: 'Straight 8ths, power chords, root-note bass.',
    instruments: { drums: 'drum-kit', bass: 'picked-bass', rhythm: 'distortion-guitar', lead: 'overdrive-guitar' },
  },
  blues: {
    id: 'blues', name: 'Blues (shuffle)', swing: 1, blurb: 'Shuffle feel, boogie guitar, walking boogie bass.',
    instruments: { drums: 'drum-kit', bass: 'fingered-bass', rhythm: 'electric-guitar-clean', lead: 'overdrive-guitar' },
  },
  country: {
    id: 'country', name: 'Country', swing: 0, blurb: 'Train beat, boom-chick bass and strummed acoustic.',
    instruments: { drums: 'drum-kit', bass: 'fingered-bass', rhythm: 'steel-guitar', lead: 'violin' },
  },
  jazz: {
    id: 'jazz', name: 'Jazz (swing)', swing: 0.7, blurb: 'Swung ride, walking bass, comping shell voicings.',
    instruments: { drums: 'drum-kit', bass: 'acoustic-bass', rhythm: 'jazz-guitar', lead: 'tenor-sax' },
  },
  pop: {
    id: 'pop', name: 'Pop', swing: 0, blurb: 'Kick-driven bass, keyboard arpeggios.',
    instruments: { drums: 'drum-kit', bass: 'fingered-bass', rhythm: 'electric-piano', lead: 'electric-guitar-clean' },
  },
};
export const STYLE_IDS: StyleId[] = ['rock', 'blues', 'country', 'jazz', 'pop'];
export const ROLES: BandRole[] = ['drums', 'bass', 'rhythm', 'lead'];
export const ROLE_NAMES: Record<BandRole, string> = { drums: 'Drums', bass: 'Bass', rhythm: 'Rhythm', lead: 'Lead' };

export function defaultBand(style: StyleId = 'rock', sourceTrackId?: string, seed = 1): BandSettings {
  return {
    style,
    players: ROLES.map((role) => ({ role, on: true, instrumentId: STYLES[style].instruments[role], complexity: 'normal', octave: 0 })),
    bassFollowsKick: false,
    ending: true,
    seed,
    sourceTrackId,
  };
}

/** Switch style: instruments that were the old style's defaults follow the new style. */
export function withStyle(b: BandSettings, style: StyleId): BandSettings {
  const old = STYLES[b.style].instruments;
  return {
    ...b,
    style,
    players: b.players.map((p) => ({ ...p, instrumentId: p.instrumentId === old[p.role] ? STYLES[style].instruments[p.role] : p.instrumentId })),
  };
}

// ---------------- helpers ----------------

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const seedHash = (...parts: (string | number)[]) => parseInt(hashOf(parts), 16);

export const GM = { kick: 36, sideStick: 37, snare: 38, hhClosed: 42, hhPedal: 44, hhOpen: 46, crash: 49, ride: 51, tomHi: 50, tomMid: 48, tomLow: 45, tomFloor: 43 } as const;

const STEP = 240; // 16th
const BEAT = 960;

interface Ctx {
  song: Song;
  starts: number[];
  sections: SectionRange[];
  settings: BandSettings;
  /** Seed per section start bar (overrides). */
  sectionSeeds: Record<string, number>;
  baseSeed: number;
  fallback: ChordInfo;
}

function sectionOf(ctx: Ctx, bar: number): SectionRange {
  return ctx.sections.find((s) => bar >= s.startBar && bar < s.endBar) ?? ctx.sections[0];
}

function rngFor(ctx: Ctx, role: BandRole, bar: number): Rng {
  const sec = sectionOf(ctx, bar);
  const seed = ctx.sectionSeeds[String(sec.startBar)] ?? ctx.baseSeed;
  return mulberry32(seedHash(seed, role, bar));
}

function chordInfo(ctx: Ctx, bar: number, tick: number): ChordInfo {
  const c = chordAt(ctx.song.chordSymbols, bar, tick);
  return (c && parseChord(c.name)) || ctx.fallback;
}

function beatsIn(ctx: Ctx, bar: number): number {
  return Math.max(1, Math.floor(barTicks(ctx.song.bars[bar]) / BEAT));
}

/** Lowest pitch >= lo with this pitch class. */
const pcAtOrAbove = (pc: number, lo: number) => lo + ((((pc - lo) % 12) + 12) % 12);

const isBackbeat = (b: number, n: number) => (n === 3 ? b > 0 : b % 2 === 1);
const isDownKick = (b: number, n: number) => (n === 3 ? b === 0 : b % 2 === 0);

const ev = (start: number, dur: number, pitch: number, velocity: number): NoteEvent => ({ start, dur, pitch, velocity, staff: 0, voice: 0 });

function isLastBar(ctx: Ctx, bar: number) {
  return bar === ctx.song.bars.length - 1;
}
function endingBar(ctx: Ctx, bar: number) {
  return ctx.settings.ending && isLastBar(ctx, bar);
}
/** Fill at the end of each section (the bar before the ending bar when there is an ending). */
function fillBar(ctx: Ctx, bar: number) {
  const sec = sectionOf(ctx, bar);
  if (ctx.settings.ending && bar === ctx.song.bars.length - 2) return true;
  if (endingBar(ctx, bar)) return false;
  return bar === sec.endBar - 1 && sec.endBar - sec.startBar >= 2;
}

// ---------------- drums ----------------

interface Hit { tick: number; pitch: number; vel: number }

function grooveHits(style: StyleId, cx: Complexity, b: number, n: number, rng: Rng): Hit[] {
  const h: Hit[] = [];
  const at = (step: number, pitch: number, vel: number) => h.push({ tick: b * BEAT + step * STEP, pitch, vel });
  const back = isBackbeat(b, n);
  const down = isDownKick(b, n);
  switch (style) {
    case 'rock': {
      const hatSteps = cx === 'simple' ? [0] : cx === 'normal' ? [0, 2] : [0, 1, 2, 3];
      for (const s of hatSteps) at(s, GM.hhClosed, s === 0 ? 92 : s === 2 ? 75 : 55);
      if (down) at(0, GM.kick, 105);
      if (back) at(0, GM.snare, 108);
      if (cx !== 'simple' && down && b > 0) at(2, GM.kick, 90);
      if (cx === 'normal' && b === n - 1 && rng() < 0.35) at(2, GM.hhOpen, 80);
      if (cx === 'normal' && back && b < n - 1 && rng() < 0.25) at(2, GM.kick, 82);
      if (cx === 'busy') {
        if (back && rng() < 0.5) at(3, GM.kick, 85);
        if (rng() < 0.3) at(3, GM.snare, 35);
      }
      break;
    }
    case 'blues': {
      const ride = cx === 'busy' ? GM.ride : GM.hhClosed;
      at(0, ride, 88);
      if (cx !== 'simple') at(2, ride, 68);
      if (down) at(0, GM.kick, 98);
      if (back) at(0, GM.snare, 100);
      if (b === n - 1 && (cx === 'busy' || rng() < 0.3)) at(2, GM.kick, 80);
      break;
    }
    case 'country': {
      if (down) at(0, GM.kick, 100);
      if (cx === 'busy') {
        // Train beat: snare 16ths, accents on the backbeat.
        for (let s = 0; s < 4; s++) at(s, GM.snare, back && s === 0 ? 105 : 38);
      } else {
        if (back) at(0, cx === 'simple' ? GM.sideStick : GM.snare, 95);
        at(0, GM.hhClosed, 80);
        if (cx === 'normal') at(2, GM.hhClosed, 62);
        if (cx === 'normal' && b === n - 1 && rng() < 0.3) at(2, GM.kick, 78);
      }
      break;
    }
    case 'jazz': {
      at(0, GM.ride, 85);
      if (cx !== 'simple' && back) at(2, GM.ride, 70); // the "skip" note (swung by playback)
      if (back) at(0, GM.hhPedal, 70);
      if (cx !== 'simple') at(0, GM.kick, 38); // feathered kick
      if (cx !== 'simple' && rng() < (cx === 'busy' ? 0.35 : 0.15)) at(2, GM.snare, 45 + Math.floor(rng() * 25));
      break;
    }
    case 'pop': {
      const hatSteps = cx === 'simple' ? [0] : cx === 'normal' ? [0, 2] : [0, 1, 2, 3];
      for (const s of hatSteps) at(s, GM.hhClosed, s === 0 ? 85 : s === 2 ? 70 : 50);
      if (down) at(0, GM.kick, 102);
      if (back) at(0, GM.snare, 104);
      if (cx !== 'simple' && back && b < n - 1) at(2, GM.kick, 88); // "and of 2"
      if (cx === 'busy' && rng() < 0.4) at(3, GM.kick, 80);
      if (cx === 'normal' && b === n - 1 && rng() < 0.35) at(2, GM.hhOpen, 78);
      break;
    }
  }
  return h;
}

const FILLS: number[][] = [
  [GM.snare, GM.snare, GM.tomHi, GM.tomHi, GM.tomMid, GM.tomMid, GM.tomFloor, GM.tomFloor],
  [GM.snare, GM.tomHi, GM.tomMid, GM.tomLow, GM.snare, GM.tomHi, GM.tomLow, GM.tomFloor],
  [GM.snare, GM.snare, GM.snare, GM.snare, GM.snare, GM.snare, GM.snare, GM.snare],
];

function drumBar(ctx: Ctx, bar: number, cx: Complexity, rng: Rng): Hit[] {
  const n = beatsIn(ctx, bar);
  const style = ctx.settings.style;
  const sec = sectionOf(ctx, bar);
  if (endingBar(ctx, bar)) return [{ tick: 0, pitch: GM.crash, vel: 115 }, { tick: 0, pitch: GM.kick, vel: 110 }];
  let hits: Hit[] = [];
  const fillBeats = fillBar(ctx, bar) ? Math.min(n - 1, cx === 'simple' ? 1 : 2) : 0;
  for (let b = 0; b < n - fillBeats; b++) hits.push(...grooveHits(style, cx, b, n, rng));
  if (fillBeats) {
    const f = FILLS[Math.floor(rng() * FILLS.length)];
    const sixteenths = cx !== 'simple';
    const startBeat = n - fillBeats;
    const steps = fillBeats * 4;
    for (let s = 0, k = 0; s < steps; s += sixteenths ? 1 : 2, k++) {
      hits.push({ tick: startBeat * BEAT + s * STEP, pitch: f[Math.min(f.length - 1, Math.floor((k * f.length) / (steps / (sixteenths ? 1 : 2))))], vel: 80 + Math.round((s / steps) * 35) });
    }
    hits.push({ tick: startBeat * BEAT, pitch: GM.kick, vel: 100 });
  }
  // Crash on the first downbeat of each section.
  if (bar === sec.startBar) {
    hits = hits.filter((x) => !(x.tick === 0 && (x.pitch === GM.hhClosed || x.pitch === GM.ride)));
    hits.push({ tick: 0, pitch: GM.crash, vel: 110 });
    if (!hits.some((x) => x.tick === 0 && x.pitch === GM.kick)) hits.push({ tick: 0, pitch: GM.kick, vel: 105 });
  }
  return hits;
}

function drumEvents(ctx: Ctx, p: PlayerSetup): NoteEvent[] {
  const out: NoteEvent[] = [];
  ctx.song.bars.forEach((bar, bi) => {
    const len = barTicks(bar);
    for (const h of drumBar(ctx, bi, p.complexity, rngFor(ctx, 'drums', bi))) {
      const dur = endingBar(ctx, bi) ? len : STEP;
      out.push(ev(ctx.starts[bi] + h.tick, dur, h.pitch, h.vel));
    }
  });
  return out;
}

/** Kick drum ticks (within the bar) as the drummer would play them; used by "bass follows kick". */
function kickTicks(ctx: Ctx, bar: number): number[] {
  const drummer = ctx.settings.players.find((p) => p.role === 'drums');
  const hits = drumBar(ctx, bar, drummer?.complexity ?? 'normal', rngFor(ctx, 'drums', bar));
  return [...new Set(hits.filter((h) => h.pitch === GM.kick).map((h) => h.tick))].sort((a, b) => a - b);
}

// ---------------- bass ----------------

const BASS_LO = 28; // E1
const bassRoot = (c: ChordInfo) => pcAtOrAbove(c.bass, BASS_LO);
const fifthOf = (c: ChordInfo) => (QUALITIES[c.quality].intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7);
const thirdOf = (c: ChordInfo) => (QUALITIES[c.quality].intervals.find((i) => i === 3 || i === 4) ?? (c.quality === 'sus2' ? 2 : 5));
const seventhOf = (c: ChordInfo) => (QUALITIES[c.quality].intervals.find((i) => i === 10 || i === 11 || i === 9) ?? 10);

function bassEvents(ctx: Ctx, p: PlayerSetup): NoteEvent[] {
  const out: NoteEvent[] = [];
  const style = ctx.settings.style;
  const cx = p.complexity;
  let prev = 36;
  const near = (pc: number) => {
    // Pitch of this class closest to the previous note, kept in E1..G3.
    let best = pcAtOrAbove(pc, BASS_LO);
    for (let x = best; x <= 55; x += 12) if (Math.abs(x - prev) < Math.abs(best - prev)) best = x;
    return best;
  };
  ctx.song.bars.forEach((bar, bi) => {
    const bs = ctx.starts[bi];
    const n = beatsIn(ctx, bi);
    const len = barTicks(bar);
    const rng = rngFor(ctx, 'bass', bi);
    const add = (tick: number, dur: number, pitch: number, vel = 96) => {
      out.push(ev(bs + tick, Math.min(dur, len - tick), pitch, vel));
      prev = pitch;
    };
    const at = (tick: number) => chordInfo(ctx, bi, tick);
    if (endingBar(ctx, bi)) {
      add(0, len, bassRoot(at(0)), 100);
      return;
    }
    if (ctx.settings.bassFollowsKick) {
      const kicks = kickTicks(ctx, bi);
      kicks.forEach((k, i) => {
        const c = at(k);
        const r = bassRoot(c);
        const end = i + 1 < kicks.length ? kicks[i + 1] : len;
        let pitch = r;
        if (cx === 'busy' && i % 3 === 2) pitch = r + 12;
        else if (cx === 'busy' && i % 3 === 1) pitch = r + fifthOf(c);
        add(k, Math.min(end - k, 2 * BEAT), pitch, i === 0 ? 102 : 92);
      });
      return;
    }
    const nextRootPc = bi + 1 < ctx.song.bars.length ? chordInfo(ctx, bi + 1, 0).bass : at(0).bass;
    switch (style) {
      case 'rock': {
        if (cx === 'simple') {
          for (let b = 0; b < n; b += 2) add(b * BEAT, Math.min(2, n - b) * BEAT, bassRoot(at(b * BEAT)));
        } else {
          for (let s = 0; s < n * 2; s++) {
            const t = s * 480;
            const c = at(t);
            let pitch = bassRoot(c);
            if (cx === 'busy') {
              if (s === n * 2 - 1 && nextRootPc !== c.bass) pitch = pcAtOrAbove(nextRootPc, BASS_LO) - 1 >= BASS_LO ? pcAtOrAbove(nextRootPc, BASS_LO) - 1 : pitch;
              else if (s % 4 === 3 && rng() < 0.5) pitch = bassRoot(c) + 12;
            }
            add(t, 480, pitch, s % 2 === 0 ? 98 : 84);
          }
        }
        break;
      }
      case 'blues': {
        if (cx === 'simple') {
          for (let b = 0; b < n; b += 2) add(b * BEAT, Math.min(2, n - b) * BEAT, b === 0 ? bassRoot(at(0)) : bassRoot(at(b * BEAT)) + 7);
        } else {
          // Boogie line: 1 3 5 6 | b7 6 5 3 (alternating bars), quarters or pumping 8ths.
          const up = [0, 4, 7, 9];
          const down = [10, 9, 7, 4];
          const line = bi % 2 === 0 ? up : down;
          for (let b = 0; b < n; b++) {
            const c = at(b * BEAT);
            const deg = line[b % 4] === 4 ? thirdOf(c) : line[b % 4];
            const pitch = bassRoot(c) + deg;
            if (cx === 'busy') {
              add(b * BEAT, 480, pitch, 98);
              add(b * BEAT + 480, 480, pitch, 80);
            } else add(b * BEAT, BEAT, pitch, 96);
          }
        }
        break;
      }
      case 'country': {
        for (let b = 0; b < n; b++) {
          const c = at(b * BEAT);
          const r = bassRoot(c);
          const onBoom = n === 3 ? b === 0 : b % 2 === 0;
          if (!onBoom && cx === 'simple') continue;
          if (onBoom) {
            const alt = n === 3 ? false : b % 4 === 2;
            const fifth = r + fifthOf(c) - 12 >= BASS_LO ? r + fifthOf(c) - 12 : r + fifthOf(c);
            add(b * BEAT, cx === 'simple' ? 2 * BEAT : BEAT * 0.75, alt ? fifth : r, 98);
          } else if (cx === 'busy' && b === n - 1 && nextRootPc !== c.bass) {
            // Walk up to the next chord in 8ths.
            const target = near(nextRootPc);
            add(b * BEAT, 480, target - 2, 88);
            add(b * BEAT + 480, 480, target - 1, 90);
          }
        }
        break;
      }
      case 'jazz': {
        if (cx === 'simple') {
          // Two-feel: root and fifth in half notes.
          for (let b = 0; b < n; b += 2) {
            const c = at(b * BEAT);
            add(b * BEAT, Math.min(2, n - b) * BEAT, b === 0 ? near(c.bass) : near((c.root + fifthOf(c)) % 12), 92);
          }
          break;
        }
        for (let b = 0; b < n; b++) {
          const c = at(b * BEAT);
          let pc: number;
          if (b === 0) pc = c.bass;
          else if (b === n - 1) {
            // Approach the next root by a half step (above or below) or its fifth.
            const r = rng();
            const target = near(nextRootPc);
            const pitch = r < 0.4 ? target - 1 : r < 0.8 ? target + 1 : target + 7 > 55 ? target - 5 : target + 7;
            if (cx === 'busy' && rng() < 0.2) {
              add(b * BEAT, 480, pitch + 2, 84);
              add(b * BEAT + 480, 480, pitch, 88);
            } else add(b * BEAT, BEAT, Math.max(BASS_LO, Math.min(55, pitch)), 90);
            continue;
          } else {
            const tones = [thirdOf(c), fifthOf(c), seventhOf(c), 2, 0];
            pc = (c.root + tones[Math.floor(rng() * tones.length)]) % 12;
          }
          add(b * BEAT, BEAT, near(pc), b === 0 ? 96 : 88);
        }
        break;
      }
      case 'pop': {
        if (cx === 'simple') {
          for (let b = 0; b < n; b += 2) add(b * BEAT, Math.min(2, n - b) * BEAT, bassRoot(at(b * BEAT)));
        } else if (cx === 'normal') {
          // Follow the pop kick pattern.
          const kicks = kickTicks(ctx, bi);
          kicks.forEach((k, i) => {
            const end = i + 1 < kicks.length ? kicks[i + 1] : len;
            add(k, end - k, bassRoot(at(k)), i === 0 ? 100 : 90);
          });
        } else {
          for (let s = 0; s < n * 2; s++) {
            const c = at(s * 480);
            add(s * 480, 480, bassRoot(c) + (s % 2 === 1 && rng() < 0.5 ? 12 : 0), s % 2 ? 82 : 98);
          }
        }
        break;
      }
    }
  });
  return out;
}

// ---------------- rhythm guitar / keys ----------------

const GUITAR_SHAPES: Record<Quality, number[]> = {
  maj: [0, 7, 12, 16, 19, 24], min: [0, 7, 12, 15, 19, 24], '7': [0, 7, 10, 16, 19, 24], maj7: [0, 7, 11, 16, 19],
  m7: [0, 7, 10, 15, 19, 24], dim: [0, 6, 12, 15], dim7: [0, 6, 9, 15, 18], m7b5: [0, 6, 10, 15], aug: [0, 8, 12, 16],
  sus2: [0, 7, 12, 14, 19], sus4: [0, 7, 12, 17, 19, 24], '5': [0, 7, 12], '6': [0, 7, 9, 16, 19], m6: [0, 7, 9, 15, 19],
};

interface Voicing { pitches: number[]; pos?: ({ string: number; fret: number } | null)[] }

/**
 * A chord shape the way a guitarist holds it: the shape's notes on adjacent strings, root on
 * the low E string (E shape) or the A string (A shape), at the position nearest the hand.
 * Falls back to the general fretting search if no shape fits.
 */
function guitarVoicing(c: ChordInfo, tuning: number[], around: number, power: boolean): Voicing {
  const shape = power ? GUITAR_SHAPES['5'] : GUITAR_SHAPES[c.quality];
  let best: Voicing | null = null;
  let bestScore = Infinity;
  for (const s0 of [0, 1]) {
    if (s0 >= tuning.length) continue;
    const n = Math.min(shape.length, tuning.length - s0);
    const base = (((c.root - tuning[s0]) % 12) + 12) % 12;
    for (const f of [base, base + 12]) {
      const r = tuning[s0] + f;
      const pos: { string: number; fret: number }[] = [];
      const pitches: number[] = [];
      let ok = true;
      for (let i = 0; i < n; i++) {
        const fret = r + shape[i] - tuning[s0 + i];
        if (fret < 0 || fret > 15) { ok = false; break; }
        pitches.push(r + shape[i]);
        pos.push({ string: s0 + i + 1, fret });
      }
      if (!ok || pitches.length < Math.min(3, shape.length)) continue;
      const fretted = pos.map((x) => x.fret).filter((x) => x > 0);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > 4) continue;
      const score = Math.abs(f - around) + (s0 === 1 && !power ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { pitches, pos };
      }
    }
  }
  if (best) return best;
  const r = pcAtOrAbove(c.root, tuning[0]);
  const pitches = shape.slice(0, 4).map((i) => r + i);
  const pos = assignChord(pitches, tuning, { aroundFret: around, maxFret: 15 });
  const keep = pitches.map((p2, i) => ({ p: p2, pos: pos[i] })).filter((x) => x.pos);
  return keep.length ? { pitches: keep.map((x) => x.p), pos: keep.map((x) => x.pos) } : { pitches: [r, r + 7] };
}

function keysVoicing(c: ChordInfo, prev: number[] | null, jazz: boolean): Voicing {
  let tones = chordTones(c);
  if (jazz && tones.length === 3 && (c.quality === 'maj' || c.quality === 'min')) tones = [...tones, (c.root + 9) % 12];
  const cands: number[][] = [];
  for (let low = 52; low <= 64; low++) {
    if (!tones.includes(low % 12)) continue;
    const v = [low];
    let p = low;
    while (v.length < tones.length) {
      p++;
      if (tones.includes(p % 12) && !v.some((x) => x % 12 === p % 12)) v.push(p);
    }
    cands.push(v);
  }
  const center = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 62;
  const cost = (v: number[]) =>
    prev ? v.reduce((a, x, i) => a + Math.abs(x - (prev[Math.min(i, prev.length - 1)] ?? x)), 0) : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
  cands.sort((a, b) => cost(a) - cost(b));
  return { pitches: cands[0] ?? tones.map((t) => 60 + t) };
}

function rhythmEvents(ctx: Ctx, p: PlayerSetup): NoteEvent[] {
  const inst = findInstrument(p.instrumentId);
  const tuning = inst?.tuning;
  const out: NoteEvent[] = [];
  const style = ctx.settings.style;
  const cx = p.complexity;
  let around = 3;
  let prevKeys: number[] | null = null;
  const voicing = (c: ChordInfo, power = false): Voicing => {
    if (tuning) {
      const v = guitarVoicing(c, tuning, around, power);
      const frets = (v.pos ?? []).filter((x) => x && x.fret > 0).map((x) => x!.fret);
      if (frets.length) around = frets.reduce((a, b) => a + b, 0) / frets.length;
      return v;
    }
    const v = keysVoicing(c, prevKeys, style === 'jazz');
    prevKeys = v.pitches;
    return v;
  };
  const emit = (abs: number, dur: number, v: Voicing, vel: number, idx?: number[], palmMute = false) => {
    const take = idx ? idx.filter((i) => i < v.pitches.length) : v.pitches.map((_, i) => i);
    for (const i of take) {
      const e = ev(abs, dur, v.pitches[i], vel);
      const ps = v.pos?.[i];
      if (ps) {
        e.string = ps.string;
        e.fret = ps.fret;
      }
      if (palmMute) e.techniques = { palmMute: true };
      out.push(e);
    }
  };
  ctx.song.bars.forEach((bar, bi) => {
    const bs = ctx.starts[bi];
    const n = beatsIn(ctx, bi);
    const len = barTicks(bar);
    const rng = rngFor(ctx, 'rhythm', bi);
    const at = (t: number) => chordInfo(ctx, bi, t);
    if (endingBar(ctx, bi)) {
      emit(bs, len, voicing(at(0)), 100);
      return;
    }
    switch (style) {
      case 'rock': {
        const power = !!tuning;
        if (cx === 'simple') {
          for (let b = 0; b < n; b += 2) emit(bs + b * BEAT, Math.min(2, n - b) * BEAT, voicing(at(b * BEAT), power), 96);
        } else {
          for (let s = 0; s < n * 2; s++) {
            const t = s * 480;
            const pm = !!tuning && s % 4 !== 0;
            emit(bs + t, 480, voicing(at(t), power), s % 4 === 0 ? 104 : 86, undefined, pm);
          }
          if (cx === 'busy' && n >= 4 && rng() < 0.6) {
            // Push into beat 3 by a 16th (replaces the 8th on the "and" of 2).
            // (buildMeasures shortens the 8th before it.)
            emit(bs + 2 * BEAT - STEP, STEP, voicing(at(2 * BEAT), power), 100);
          }
        }
        break;
      }
      case 'blues': {
        if (tuning && cx !== 'simple') {
          // Boogie: root+5th / root+6th (and b7 when busy) on the low strings.
          for (let b = 0; b < n; b++) {
            const c = at(b * BEAT);
            const r = pcAtOrAbove(c.root, tuning[0]);
            const top = b % 2 === 0 ? 7 : cx === 'busy' && b % 4 === 3 ? 10 : 9;
            for (const half of [0, 480]) {
              const pitches = [r, r + top];
              const pos = assignChord(pitches, tuning, { aroundFret: 3, maxFret: 12 });
              emit(bs + b * BEAT + half, 480, { pitches, pos }, half ? 78 : 96);
            }
          }
        } else {
          // Stabs on 2 and 4 (keys, or simple).
          for (let b = 0; b < n; b++) if (isBackbeat(b, n)) emit(bs + b * BEAT, 480, voicing(at(b * BEAT)), 92);
          if (cx === 'busy') for (let b = 0; b < n; b++) if (!isBackbeat(b, n)) emit(bs + b * BEAT + 480, 480, voicing(at(b * BEAT + 480)), 76);
        }
        break;
      }
      case 'country': {
        for (let b = 0; b < n; b++) {
          const c = at(b * BEAT);
          const v = voicing(c);
          const boom = n === 3 ? b === 0 : b % 2 === 0;
          if (cx === 'simple') {
            if (boom) emit(bs + b * BEAT, Math.min(2, n - b) * BEAT, v, 90);
            continue;
          }
          if (boom) emit(bs + b * BEAT, BEAT, v, 96, [b % 4 === 2 ? Math.min(1, v.pitches.length - 1) : 0]);
          else emit(bs + b * BEAT, cx === 'busy' ? 480 : BEAT, v, 88, v.pitches.map((_, i) => i).slice(Math.max(1, v.pitches.length - 4)));
          if (cx === 'busy' && !boom) emit(bs + b * BEAT + 480, 480, v, 70, v.pitches.map((_, i) => i).slice(Math.max(1, v.pitches.length - 3)));
        }
        break;
      }
      case 'jazz': {
        const shell = (c: ChordInfo): Voicing => {
          if (!tuning) return voicing(c);
          const r = pcAtOrAbove(c.root, tuning[0]);
          const third = thirdOf(c);
          const sev = c.quality === 'maj' ? 9 : c.quality === 'min' ? 10 : seventhOf(c);
          const pitches = [r, r + sev, r + third + 12];
          const pos = assignChord(pitches, tuning, { aroundFret: around, maxFret: 12 });
          return { pitches, pos };
        };
        if (cx === 'simple') {
          for (let b = 0; b < n; b++) if (isBackbeat(b, n)) emit(bs + b * BEAT, 480, shell(at(b * BEAT)), 80);
          break;
        }
        // Charleston (1, "and" of 2) or "and" of 1 + 3, picked per bar; busy adds anticipations.
        const pattern = rng() < 0.6 ? [[0, 720], [1440, 360]] : [[480, 480], [1920, 480]];
        if (n >= 4 && cx === 'busy' && rng() < 0.5) pattern.push([3 * BEAT + 480, 480]);
        for (const [t, d] of pattern) if (t < len) emit(bs + t, Math.min(d, len - t), shell(at(t)), 78 + Math.floor(rng() * 12));
        break;
      }
      case 'pop': {
        if (cx === 'simple') {
          for (let b = 0; b < n; b += 2) emit(bs + b * BEAT, Math.min(2, n - b) * BEAT, voicing(at(b * BEAT)), 84);
          break;
        }
        const stepLen = cx === 'busy' ? STEP : 480;
        const count = len / stepLen;
        const order = [0, 1, 2, 3, 2, 1];
        for (let s = 0; s < count; s++) {
          const t = s * stepLen;
          const v = voicing(at(t));
          const i = order[s % order.length] % v.pitches.length;
          emit(bs + t, stepLen, v, s % (BEAT / stepLen) === 0 ? 90 : 72, [i]);
        }
        break;
      }
    }
  });
  return out;
}

// ---------------- lead ----------------

/** Full playable range (sounding MIDI pitches) per instrument group / instrument. */
const PLAYABLE: Record<string, [number, number]> = {
  Keys: [21, 108], Guitars: [40, 88], Basses: [28, 67], Strings: [55, 103], Brass: [52, 84], Winds: [55, 91], Synths: [24, 108], Drums: [27, 87],
};
const PLAYABLE_BY_ID: Record<string, [number, number]> = {
  viola: [48, 91], cello: [36, 76], contrabass: [28, 67], harp: [24, 103], 'string-ensemble': [28, 96], 'pizzicato-strings': [28, 96],
  trombone: [40, 72], tuba: [28, 58], 'french-horn': [34, 77], 'brass-section': [34, 84],
  'tenor-sax': [44, 76], 'alto-sax': [49, 81], 'soprano-sax': [56, 88], flute: [60, 96], 'pan-flute': [60, 96], oboe: [58, 91], clarinet: [50, 91],
};
/** Where a lead line sits comfortably (the melody is moved by octaves to fit here). */
const LEAD: Record<string, [number, number]> = {
  Keys: [55, 84], Guitars: [52, 84], Basses: [36, 60], Strings: [55, 93], Brass: [55, 80], Winds: [58, 88], Synths: [55, 88],
};
const LEAD_BY_ID: Record<string, [number, number]> = {
  viola: [50, 81], cello: [40, 69], contrabass: [33, 55], trombone: [43, 67], tuba: [31, 55], 'french-horn': [41, 72],
  'tenor-sax': [46, 74], 'alto-sax': [51, 79], 'soprano-sax': [58, 86], flute: [62, 93], 'pan-flute': [62, 93], oboe: [60, 88], clarinet: [52, 86],
};

export function instrumentRange(id: string): [number, number] {
  const c = findInstrument(id);
  return PLAYABLE_BY_ID[id] ?? (c ? PLAYABLE[c.group] : [21, 108]);
}

export function leadRange(id: string): [number, number] {
  const c = findInstrument(id);
  return LEAD_BY_ID[id] ?? (c ? LEAD[c.group] ?? [55, 84] : [55, 84]);
}

/** Octave shift (semitones) that best fits pitches into a range. */
export function fitOctave(pitches: number[], range: [number, number]): number {
  if (!pitches.length) return 0;
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const center = (range[0] + range[1]) / 2;
  let best = 0;
  let bestCost = Infinity;
  for (let k = -4; k <= 4; k++) {
    const out = pitches.filter((p) => p + 12 * k < range[0] || p + 12 * k > range[1]).length;
    const cost = out * 100 + Math.abs(mean + 12 * k - center);
    if (cost < bestCost) {
      bestCost = cost;
      best = 12 * k;
    }
  }
  return best;
}

function leadStaves(ctx: Ctx, p: PlayerSetup, source: Track): Staff[] {
  const parts = extractPart(ctx.song, source, 'melody');
  let staff: Staff;
  if (parts.length === 1) staff = parts[0];
  else {
    // Melody spread over several staves: merge through events (single voice).
    const tmp: Track = { ...source, staves: parts };
    staff = { clef: 'treble', measures: buildMeasures(ctx.song, trackEvents(ctx.song, tmp)) };
  }
  const pitches: number[] = [];
  for (const m of staff.measures) for (const v of m.voices) for (const b of v.beats) for (const x of b.notes) pitches.push(x.pitch);
  let shift = fitOctave(pitches, leadRange(p.instrumentId)) + 12 * (p.octave ?? 0);
  // A chosen octave may not leave the instrument's playable range.
  const [lo, hi] = instrumentRange(p.instrumentId);
  while (pitches.length && Math.max(...pitches) + shift > hi && Math.min(...pitches) + shift - 12 >= lo) shift -= 12;
  while (pitches.length && Math.min(...pitches) + shift < lo && Math.max(...pitches) + shift + 12 <= hi) shift += 12;
  const inst = findInstrument(p.instrumentId);
  let around = 5;
  for (const m of staff.measures)
    for (const v of m.voices)
      for (const b of v.beats) {
        for (const x of b.notes) {
          x.pitch = Math.max(0, Math.min(127, x.pitch + shift));
          delete x.string;
          delete x.fret;
        }
        if (inst?.tuning && b.notes.length === 1 && !b.notes[0].tieFromPrevious) {
          // One note: the string that keeps the hand nearest its current position.
          const x = b.notes[0];
          const opts = positionsFor(x.pitch, inst.tuning);
          opts.sort((m, n) => Math.abs(m.fret - around) - Math.abs(n.fret - around) || n.string - m.string);
          if (opts[0]) {
            x.string = opts[0].string;
            x.fret = opts[0].fret;
            if (opts[0].fret > 0) around = (around * 3 + opts[0].fret) / 4;
          }
        } else if (inst?.tuning && b.notes.length) {
          const pos = assignChord(b.notes.map((x) => x.pitch), inst.tuning, { aroundFret: around });
          b.notes.forEach((x, i) => {
            if (pos[i]) {
              x.string = pos[i]!.string;
              x.fret = pos[i]!.fret;
              if (pos[i]!.fret > 0) around = (around * 2 + pos[i]!.fret) / 3;
            }
          });
        }
      }
  // Tied notes must keep the string/fret of the note they continue.
  for (const m of staff.measures)
    for (const v of m.voices) {
      const last = new Map<number, { string?: number; fret?: number }>();
      for (const b of v.beats)
        for (const x of b.notes) {
          const prev = last.get(x.pitch);
          if (x.tieFromPrevious && prev?.string !== undefined) {
            x.string = prev.string;
            x.fret = prev.fret;
          }
          last.set(x.pitch, { string: x.string, fret: x.fret });
        }
    }
  staff.clef = shiftClef(pitches.map((x) => x + shift), !!inst?.tuning);
  return [staff];
}

function shiftClef(pitches: number[], fretted: boolean): Staff['clef'] {
  if (fretted || !pitches.length) return 'treble';
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  return mean < 55 ? 'bass' : 'treble';
}

// ---------------- generate ----------------

function makeCtx(song: Song, settings: BandSettings, sectionSeeds: Record<string, number> = {}): Ctx {
  const key = song.bars[0]?.key ?? { fifths: 0, mode: 'major' as const };
  const tonicMajor = (((key.fifths * 7) % 12) + 12) % 12;
  const fallback: ChordInfo = key.mode === 'minor'
    ? { root: (tonicMajor + 9) % 12, quality: 'min', bass: (tonicMajor + 9) % 12 }
    : { root: tonicMajor, quality: 'maj', bass: tonicMajor };
  return { song, starts: barStartTicks(song), sections: sectionRanges(song), settings, sectionSeeds, baseSeed: settings.seed, fallback };
}

export function sourceTrackFor(song: Song, settings: BandSettings): Track | undefined {
  return song.tracks.find((t) => t.id === settings.sourceTrackId && !t.generated && !t.instrument.percussion) ?? harmonySourceTracks(song)[0];
}

const ROLE_MIX: Record<BandRole, { volume: number; pan: number }> = {
  drums: { volume: 0.75, pan: 0 }, bass: { volume: 0.85, pan: 0 }, rhythm: { volume: 0.6, pan: -0.35 }, lead: { volume: 0.8, pan: 0.2 },
};

function buildPart(ctx: Ctx, p: PlayerSetup, source: Track | undefined): Staff[] {
  const inst = findInstrument(p.instrumentId);
  const tuning = inst?.tuning;
  switch (p.role) {
    case 'drums':
      return [{ clef: 'neutral', measures: buildMeasures(ctx.song, drumEvents(ctx, p), { percussion: true }) }];
    case 'bass':
      return [{ clef: 'bass', measures: buildMeasures(ctx.song, bassEvents(ctx, p), { tuning }) }];
    case 'rhythm':
      return [{ clef: 'treble', measures: buildMeasures(ctx.song, rhythmEvents(ctx, p), { tuning }) }];
    case 'lead':
      if (!source) return [{ clef: 'treble', measures: ctx.song.bars.map(() => ({ voices: [{ beats: [] }] })) }];
      return leadStaves(ctx, p, source);
  }
}

function tagFor(settings: BandSettings, p: PlayerSetup, source: Track | undefined, staves: Staff[], sectionSeeds?: Record<string, number>): GeneratedTag {
  const tag: GeneratedTag = {
    style: settings.style, role: p.role, complexity: p.complexity, seed: settings.seed,
    bassFollowsKick: settings.bassFollowsKick, ending: settings.ending, contentHash: hashOf(staves),
  };
  if (source) tag.sourceTrackId = source.id;
  if (p.role === 'lead') tag.octave = p.octave ?? 0;
  if (sectionSeeds && Object.keys(sectionSeeds).length) tag.sectionSeeds = { ...sectionSeeds };
  return tag;
}

function makeTrack(ctx: Ctx, p: PlayerSetup, source: Track | undefined, id: string, sectionSeeds?: Record<string, number>): Track {
  const inst = findInstrument(p.instrumentId) ?? findInstrument(STYLES[ctx.settings.style].instruments[p.role])!;
  const staves = buildPart(ctx, { ...p, instrumentId: inst.id }, source);
  const percussion = !!inst.percussion;
  const t: Track = {
    id,
    name: `${ROLE_NAMES[p.role]} (${inst.name})`,
    instrument: toInstrumentRef(inst),
    mixer: { ...ROLE_MIX[p.role], mute: false, solo: false },
    display: { visible: true, mode: inst.tuning && !percussion ? 'both' : 'notation' },
    staves,
    generated: tagFor(ctx.settings, p, source, staves, sectionSeeds),
  };
  if (inst.tuning && !percussion) {
    t.tuning = [...inst.tuning];
    t.displayTranspose = inst.displayTranspose ?? 0;
  }
  return t;
}

/** Generated tracks whose notes were changed by hand since they were generated. */
export function editedGeneratedTracks(song: Song, role?: BandRole): Track[] {
  return song.tracks.filter((t) => t.generated && (!role || t.generated.role === role) && hashOf(t.staves) !== t.generated.contentHash);
}

/**
 * Generate the whole band for the song. Existing generated tracks for the same roles are
 * replaced (keeping their mixer settings); the source track (and its split parts) is muted,
 * never deleted. Writes recognised chords into the song if it has none.
 */
export function generateBand(song: Song, settings: BandSettings): Song {
  const next = structuredClone(song);
  if (!next.chordSymbols.length) next.chordSymbols = detectChords(next);
  const source = sourceTrackFor(next, settings);
  const s: BandSettings = { ...settings, sourceTrackId: source?.id, players: settings.players.map((p) => ({ ...p })) };
  const ctx = makeCtx(next, s);
  for (const p of s.players) {
    const existing = next.tracks.findIndex((t) => t.generated?.role === p.role);
    if (!p.on) {
      if (existing >= 0) next.tracks.splice(existing, 1);
      continue;
    }
    let id = existing >= 0 ? next.tracks[existing].id : `band-${p.role}`;
    for (let k = 2; existing < 0 && next.tracks.some((t) => t.id === id); k++) id = `band-${p.role}${k}`;
    const track = makeTrack(ctx, p, source, id);
    if (existing >= 0) {
      track.mixer = { ...next.tracks[existing].mixer };
      track.display.visible = next.tracks[existing].display.visible;
      next.tracks[existing] = track;
    } else next.tracks.push(track);
  }
  if (source) {
    for (const t of next.tracks) if (t.id === source.id || t.derived?.from === source.id) t.mixer.mute = true;
  }
  next.playback = { ...(next.playback ?? { swing: 0 }), swing: STYLES[s.style].swing };
  next.band = s;
  return next;
}

/**
 * Regenerate with a new seed: one section (all players, or one) or one player (whole song).
 * Only the chosen bars of the chosen tracks change.
 */
export function regenerate(song: Song, target: { sectionStartBar?: number; role?: BandRole }, newSeed: number): Song {
  const next = structuredClone(song);
  const band = next.band;
  if (!band) throw new Error('Generate the band first.');
  const sections = sectionRanges(next);
  const sec = target.sectionStartBar !== undefined ? sections.find((x) => x.startBar === target.sectionStartBar) : undefined;
  if (target.sectionStartBar !== undefined && !sec) throw new Error('No section starts at that bar.');
  next.tracks.forEach((t, ti) => {
    const tag = t.generated;
    if (!tag || (target.role && tag.role !== target.role)) return;
    const p = band.players.find((x) => x.role === tag.role) ?? {
      role: tag.role, on: true, instrumentId: t.instrument.id, complexity: tag.complexity, octave: tag.octave,
    };
    const player: PlayerSetup = { ...p, instrumentId: t.instrument.id };
    const settings: BandSettings = { ...band, style: tag.style, seed: sec ? tag.seed : newSeed };
    const seeds: Record<string, number> = sec ? { ...(tag.sectionSeeds ?? {}), [String(sec.startBar)]: newSeed } : {};
    const ctx = makeCtx(next, settings, seeds);
    const source = next.tracks.find((x) => x.id === tag.sourceTrackId);
    const fresh = makeTrack(ctx, player, source, t.id, seeds);
    let staves: Staff[];
    if (sec) {
      staves = t.staves.map((st, si) => ({
        ...st,
        measures: st.measures.map((m, mi): Measure => (mi >= sec.startBar && mi < sec.endBar ? fresh.staves[si]?.measures[mi] ?? m : m)),
      }));
    } else staves = fresh.staves;
    next.tracks[ti] = {
      ...t,
      staves,
      generated: { ...fresh.generated!, seed: settings.seed, contentHash: hashOf(staves) },
    };
  });
  if (!sec) next.band = { ...band, seed: target.role ? band.seed : newSeed };
  return next;
}
