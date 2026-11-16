// Drum step sequencer: a bar of a drum track as a grid (lanes = kit pieces, cells = steps with a
// velocity). Reading snaps the bar's hits to the grid; writing rebuilds that bar from the grid.
// Works on generated drum tracks too (the edit shows as "edited": the staves hash changes).
import { editStaffNotes, type RollNote } from './pianoRoll';
import { sectionRanges } from './sections';
import { barStartTicks, barTicks, durationTicks } from './timing';
import { PPQ, type Song } from './types';

export interface DrumLane {
  pitch: number;
  name: string;
}

/** General MIDI percussion names (35-81). */
export const GM_DRUMS: Record<number, string> = {
  35: 'Kick 2', 36: 'Kick', 37: 'Side stick', 38: 'Snare', 39: 'Hand clap', 40: 'Snare 2', 41: 'Low floor tom',
  42: 'Hi-hat closed', 43: 'Floor tom', 44: 'Hi-hat pedal', 45: 'Low tom', 46: 'Hi-hat open', 47: 'Low-mid tom',
  48: 'Mid tom', 49: 'Crash', 50: 'High tom', 51: 'Ride', 52: 'China', 53: 'Ride bell', 54: 'Tambourine', 55: 'Splash',
  56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2', 60: 'Hi bongo', 61: 'Low bongo', 62: 'Mute hi conga',
  63: 'Open hi conga', 64: 'Low conga', 65: 'High timbale', 66: 'Low timbale', 67: 'High agogo', 68: 'Low agogo',
  69: 'Cabasa', 70: 'Maracas', 71: 'Short whistle', 72: 'Long whistle', 73: 'Short guiro', 74: 'Long guiro', 75: 'Claves',
  76: 'Hi wood block', 77: 'Low wood block', 78: 'Mute cuica', 79: 'Open cuica', 80: 'Mute triangle', 81: 'Open triangle',
};

/** The default lanes, top to bottom (most used first, so they show without scrolling). */
export const DEFAULT_LANES: number[] = [36, 38, 37, 42, 46, 44, 50, 48, 45, 43, 49, 51, 53];

export const VEL = { normal: 96, accent: 124, ghost: 48 } as const;

export interface DrumGrid {
  /** Steps in the bar. */
  steps: number;
  /** Ticks per step. */
  stepTicks: number;
  /** pitch -> velocity per step (0 = off). */
  lanes: Map<number, number[]>;
}

export type DrumRes = 16 | 32;

/** Steps per quarter note: 16 -> 4 (16ths), 32 -> 8; triplet: 16 -> 3 (8th triplets), 32 -> 6. */
export function stepsPerQuarter(res: DrumRes, triplet: boolean): number {
  return triplet ? (res === 16 ? 3 : 6) : res / 4;
}

export function gridFor(song: Song, bar: number, res: DrumRes, triplet: boolean): { steps: number; stepTicks: number } {
  const stepTicks = PPQ / stepsPerQuarter(res, triplet);
  return { steps: Math.max(1, Math.round(barTicks(song.bars[bar]) / stepTicks)), stepTicks };
}

/** Read one bar of a drum track as a grid (hits snapped to the nearest step). */
export function readDrumBar(song: Song, trackIndex: number, bar: number, res: DrumRes, triplet: boolean): DrumGrid {
  const { steps, stepTicks } = gridFor(song, bar, res, triplet);
  const lanes = new Map<number, number[]>();
  for (const p of DEFAULT_LANES) lanes.set(p, new Array(steps).fill(0));
  const t = song.tracks[trackIndex];
  for (const m of t.staves.flatMap((st) => [st.measures[bar]])) {
    if (!m) continue;
    for (const v of m.voices) {
      let tick = 0;
      for (const b of v.beats) {
        if (b.grace) continue;
        const step = Math.round(tick / stepTicks);
        for (const n of b.notes) {
          if (n.tieFromPrevious) continue;
          if (!lanes.has(n.pitch)) lanes.set(n.pitch, new Array(steps).fill(0));
          if (step < steps) lanes.get(n.pitch)![step] = Math.max(lanes.get(n.pitch)![step], n.velocity);
        }
        tick += durationTicks(b.duration);
      }
    }
  }
  return { steps, stepTicks, lanes };
}

/** Replace the hits of bars with grids (bar -> grid). One edit. */
export function writeDrumBars(song: Song, trackIndex: number, grids: Map<number, DrumGrid>): Song {
  const starts = barStartTicks(song);
  return editStaffNotes(song, trackIndex, 0, (evs) => {
    const keep = evs.filter((e) => {
      for (const [bar] of grids) {
        const s = starts[bar];
        const end = s + barTicks(song.bars[bar]);
        if (e.start >= s && e.start < end) return false;
      }
      return true;
    });
    const add: RollNote[] = [];
    for (const [bar, g] of grids) {
      for (const [pitch, cells] of g.lanes) {
        cells.forEach((v, i) => {
          if (v > 0) add.push({ start: starts[bar] + Math.round(i * g.stepTicks), dur: Math.round(g.stepTicks), pitch, velocity: v, staff: 0, voice: 0 });
        });
      }
    }
    return [...keep, ...add];
  });
}

/** Set one step (velocity 0 = clear). */
export function setDrumStep(song: Song, trackIndex: number, bar: number, res: DrumRes, triplet: boolean, pitch: number, step: number, velocity: number): Song {
  const g = readDrumBar(song, trackIndex, bar, res, triplet);
  if (!g.lanes.has(pitch)) g.lanes.set(pitch, new Array(g.steps).fill(0));
  const cells = g.lanes.get(pitch)!;
  if (step < 0 || step >= g.steps) return song;
  if (cells[step] === velocity) return song;
  cells[step] = velocity;
  return writeDrumBars(song, trackIndex, new Map([[bar, g]]));
}

/** Copy bar `from`'s hits exactly onto each bar in `to` (bars of a different length are skipped). One edit. */
export function copyDrumBar(song: Song, trackIndex: number, from: number, to: number[]): Song {
  const starts = barStartTicks(song);
  const len = barTicks(song.bars[from]);
  const targets = to.filter((b) => b !== from && b >= 0 && b < song.bars.length && barTicks(song.bars[b]) === len);
  if (!targets.length) return song;
  const inBar = (e: RollNote, b: number) => e.start >= starts[b] && e.start < starts[b] + barTicks(song.bars[b]);
  return editStaffNotes(song, trackIndex, 0, (evs) => {
    const src = evs.filter((e) => inBar(e, from));
    const keep = evs.filter((e) => !targets.some((b) => inBar(e, b)));
    const add = targets.flatMap((b) => src.map((e) => ({ ...e, start: e.start - starts[from] + starts[b] })));
    return [...keep, ...add];
  });
}

/** Copy a bar to every other bar of its section (whole song if there are no sections). */
export function fillSection(song: Song, trackIndex: number, bar: number): Song {
  const secs = sectionRanges(song);
  const sec = secs.find((s) => bar >= s.startBar && bar < s.endBar) ?? { startBar: 0, endBar: song.bars.length };
  const to: number[] = [];
  for (let b = sec.startBar; b < sec.endBar; b++) to.push(b);
  return copyDrumBar(song, trackIndex, bar, to);
}

// ---------------- pattern library ----------------

export interface DrumPattern {
  name: string;
  res: DrumRes;
  triplet: boolean;
  /** Bar length the pattern was made in (quarters per bar = steps / stepsPerQuarter). */
  steps: number;
  /** pitch -> velocities. */
  lanes: Record<string, number[]>;
  builtIn?: boolean;
}

export function patternFromBar(song: Song, trackIndex: number, bar: number, res: DrumRes, triplet: boolean, name: string): DrumPattern {
  const g = readDrumBar(song, trackIndex, bar, res, triplet);
  const lanes: Record<string, number[]> = {};
  for (const [p, cells] of g.lanes) if (cells.some((v) => v > 0)) lanes[String(p)] = cells.slice();
  return { name, res, triplet, steps: g.steps, lanes };
}

/** Put a pattern into bars (repeated/cut to each bar's length). */
export function applyPattern(song: Song, trackIndex: number, bars: number[], p: DrumPattern): Song {
  const grids = new Map<number, DrumGrid>();
  for (const b of bars) {
    const gg = gridFor(song, b, p.res, p.triplet);
    const lanes = new Map<number, number[]>();
    for (const [pitch, cells] of Object.entries(p.lanes)) {
      lanes.set(Number(pitch), Array.from({ length: gg.steps }, (_, i) => cells[i % p.steps] ?? 0));
    }
    grids.set(b, { ...gg, lanes });
  }
  return writeDrumBars(song, trackIndex, grids);
}

const N = VEL.normal;
const A = VEL.accent;
const G = VEL.ghost;
const row = (s: string, v = N) => [...s].map((ch) => (ch === 'x' ? v : ch === 'X' ? A : ch === 'g' ? G : 0));

export const BUILTIN_PATTERNS: DrumPattern[] = [
  { name: 'Rock beat (8ths)', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    42: row('x.x.x.x.x.x.x.x.'), 38: row('....X.......X...'), 36: row('x.......x.x.....') } },
  { name: 'Four on the floor', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    46: row('..x...x...x...x.'), 42: row('x...x...x...x...'), 38: row('....X.......X...'), 36: row('x...x...x...x...') } },
  { name: 'Half-time', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    42: row('x.x.x.x.x.x.x.x.'), 38: row('........X.......'), 36: row('x.....x...x.....') } },
  { name: 'Funk 16ths', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    42: row('xxxxxxxxxxxxxxxx'), 38: row('....X..g.g..X..g'), 36: row('x..x..x...x.....') } },
  { name: 'Shuffle', res: 16, triplet: true, steps: 12, builtIn: true, lanes: {
    42: row('x.xx.xx.xx.x'), 38: row('...X.....X..'), 36: row('x.....x.....') } },
  { name: 'Train beat', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    38: row('gxgXgxgXgxgXgxgX'), 36: row('x.......x.......') } },
  { name: 'Jazz ride', res: 16, triplet: true, steps: 12, builtIn: true, lanes: {
    51: row('x..x.xx..x.x'), 44: row('...x.....x..'), 36: row('g.....g.....') } },
  { name: 'Crash + kick (accent)', res: 16, triplet: false, steps: 16, builtIn: true, lanes: {
    49: row('X...............'), 36: row('X...............') } },
];
