// Mixer, effects, automation and audio clips (Round 5). Pure data + maths: the Web Audio graph
// (src/renderer/src/audio/graph.ts) builds nodes from these descriptions, both for live playback
// and for offline export, so the two always sound the same.
import { PPQ, type Song, type Track } from './types';
import { barStartTicks } from './timing';

// ---------------------------------------------------------------- gain / pan maths

/** Fader law: position 0..1 -> dB. 0.8 = 0 dB (the default), 1 = +5.8 dB, 0 = silence. */
export function faderDb(pos: number): number {
  if (pos <= 0) return -Infinity;
  return 60 * Math.log10(pos / 0.8);
}
export function dbToGain(db: number): number {
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}
export function gainToDb(g: number): number {
  return g <= 0 ? -Infinity : 20 * Math.log10(g);
}
export function faderGain(pos: number): number {
  return dbToGain(faderDb(pos));
}
/** Inverse of faderDb (for typing a dB value). */
export function dbToFader(db: number): number {
  return db === -Infinity ? 0 : 0.8 * Math.pow(10, db / 60);
}
/** Equal-power pan law (the same as Web Audio's StereoPannerNode for a mono source). */
export function panGains(pan: number): { left: number; right: number } {
  const p = Math.max(-1, Math.min(1, pan));
  const x = ((p + 1) / 2) * (Math.PI / 2);
  return { left: Math.cos(x), right: Math.sin(x) };
}
/** Effective gain of a track: fader, mute, solo (any soloed track silences the others). */
export function trackGain(song: Song, i: number): number {
  const t = song.tracks[i];
  if (!t) return 0;
  const anySolo = song.tracks.some((x) => x.mixer.solo);
  if (t.mixer.mute || (anySolo && !t.mixer.solo)) return 0;
  return faderGain(t.mixer.volume);
}

// ---------------------------------------------------------------- effects

export type FxType =
  | 'eq3' | 'peq' | 'comp' | 'gate' | 'drive' | 'amp' | 'bassamp'
  | 'chorus' | 'flanger' | 'phaser' | 'tremolo' | 'delay' | 'reverb' | 'limiter';

export interface Effect {
  id: string;
  type: FxType;
  bypass?: boolean;
  params: Record<string, number>;
}

export interface FxParam {
  key: string;
  name: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Shown as a list instead of a number. */
  options?: string[];
}

const P = (key: string, name: string, min: number, max: number, step: number, def: number, unit?: string, options?: string[]): FxParam =>
  ({ key, name, min, max, step, def, unit, options });

export const DELAY_NOTES = ['1/4', '1/8', '1/8 dotted', '1/8 triplet', '1/16', '1/2'];
/** Length of a tempo-synced delay note in quarter notes. */
export const DELAY_NOTE_QUARTERS = [1, 0.5, 0.75, 1 / 3, 0.25, 2];
export const REVERB_TYPES = ['Room', 'Hall', 'Plate'];
export const CAB_TYPES = ['4x12 closed', '2x12 open', '1x12 combo', 'Bass 8x10', 'Bass 1x15'];

export const FX_DEFS: Record<FxType, { name: string; params: FxParam[] }> = {
  eq3: { name: 'EQ (3-band)', params: [
    P('low', 'Low', -18, 18, 0.5, 0, 'dB'), P('lowFreq', 'Low freq', 40, 500, 5, 200, 'Hz'),
    P('mid', 'Mid', -18, 18, 0.5, 0, 'dB'), P('midFreq', 'Mid freq', 200, 5000, 10, 1000, 'Hz'),
    P('high', 'High', -18, 18, 0.5, 0, 'dB'), P('highFreq', 'High freq', 1500, 12000, 50, 4000, 'Hz'),
  ] },
  peq: { name: 'EQ (parametric)', params: [
    P('lowCut', 'Low cut', 10, 1000, 5, 10, 'Hz'), P('highCut', 'High cut', 1000, 20000, 100, 20000, 'Hz'),
    P('freq', 'Freq', 40, 16000, 10, 1000, 'Hz'), P('gain', 'Gain', -18, 18, 0.5, 0, 'dB'), P('q', 'Q', 0.2, 12, 0.1, 1),
    P('freq2', 'Freq 2', 40, 16000, 10, 3000, 'Hz'), P('gain2', 'Gain 2', -18, 18, 0.5, 0, 'dB'), P('q2', 'Q 2', 0.2, 12, 0.1, 1),
  ] },
  comp: { name: 'Compressor', params: [
    P('threshold', 'Threshold', -60, 0, 1, -18, 'dB'), P('ratio', 'Ratio', 1, 20, 0.5, 4),
    P('attack', 'Attack', 0.1, 100, 0.1, 10, 'ms'), P('release', 'Release', 10, 1000, 5, 150, 'ms'),
    P('knee', 'Knee', 0, 30, 1, 6, 'dB'), P('makeup', 'Makeup', 0, 24, 0.5, 4, 'dB'),
  ] },
  gate: { name: 'Gate', params: [
    P('threshold', 'Threshold', -90, 0, 1, -50, 'dB'), P('attack', 'Attack', 0.1, 50, 0.1, 1, 'ms'),
    P('hold', 'Hold', 0, 500, 5, 50, 'ms'), P('release', 'Release', 5, 1000, 5, 100, 'ms'),
  ] },
  drive: { name: 'Overdrive / distortion', params: [
    P('drive', 'Drive', 0, 1, 0.01, 0.5), P('tone', 'Tone', 500, 12000, 50, 4000, 'Hz'),
    P('mode', 'Type', 0, 2, 1, 0, undefined, ['Overdrive', 'Distortion', 'Fuzz']), P('level', 'Level', -24, 12, 0.5, -6, 'dB'),
  ] },
  amp: { name: 'Guitar amp', params: [
    P('gain', 'Gain', 0, 1, 0.01, 0.4), P('bass', 'Bass', -12, 12, 0.5, 0, 'dB'), P('mid', 'Mid', -12, 12, 0.5, 0, 'dB'),
    P('treble', 'Treble', -12, 12, 0.5, 0, 'dB'), P('presence', 'Presence', -12, 12, 0.5, 0, 'dB'),
    P('cab', 'Cabinet', 0, 4, 1, 0, undefined, CAB_TYPES), P('level', 'Level', -24, 12, 0.5, -6, 'dB'),
  ] },
  bassamp: { name: 'Bass amp', params: [
    P('gain', 'Gain', 0, 1, 0.01, 0.2), P('bass', 'Bass', -12, 12, 0.5, 2, 'dB'), P('mid', 'Mid', -12, 12, 0.5, 0, 'dB'),
    P('treble', 'Treble', -12, 12, 0.5, 0, 'dB'), P('cab', 'Cabinet', 0, 4, 1, 3, undefined, CAB_TYPES),
    P('blend', 'DI blend', 0, 1, 0.05, 0.3), P('level', 'Level', -24, 12, 0.5, -3, 'dB'),
  ] },
  chorus: { name: 'Chorus', params: [
    P('rate', 'Rate', 0.05, 5, 0.05, 0.8, 'Hz'), P('depth', 'Depth', 0, 1, 0.01, 0.5), P('mix', 'Mix', 0, 1, 0.01, 0.5),
  ] },
  flanger: { name: 'Flanger', params: [
    P('rate', 'Rate', 0.05, 5, 0.05, 0.25, 'Hz'), P('depth', 'Depth', 0, 1, 0.01, 0.7), P('feedback', 'Feedback', 0, 0.9, 0.01, 0.5),
    P('mix', 'Mix', 0, 1, 0.01, 0.5),
  ] },
  phaser: { name: 'Phaser', params: [
    P('rate', 'Rate', 0.05, 5, 0.05, 0.5, 'Hz'), P('depth', 'Depth', 0, 1, 0.01, 0.7), P('feedback', 'Feedback', 0, 0.9, 0.01, 0.4),
    P('mix', 'Mix', 0, 1, 0.01, 0.5),
  ] },
  tremolo: { name: 'Tremolo', params: [
    P('rate', 'Rate', 0.5, 15, 0.1, 5, 'Hz'), P('depth', 'Depth', 0, 1, 0.01, 0.6),
  ] },
  delay: { name: 'Delay', params: [
    P('note', 'Time', 0, DELAY_NOTES.length - 1, 1, 1, undefined, DELAY_NOTES), P('feedback', 'Feedback', 0, 0.9, 0.01, 0.35),
    P('mix', 'Mix', 0, 1, 0.01, 0.3), P('tone', 'Tone', 500, 12000, 100, 5000, 'Hz'),
  ] },
  reverb: { name: 'Reverb', params: [
    P('type', 'Type', 0, 2, 1, 0, undefined, REVERB_TYPES), P('decay', 'Decay', 0.2, 8, 0.1, 1.8, 's'),
    P('predelay', 'Pre-delay', 0, 150, 1, 10, 'ms'), P('mix', 'Mix', 0, 1, 0.01, 0.3),
  ] },
  limiter: { name: 'Limiter', params: [
    P('ceiling', 'Ceiling', -12, 0, 0.1, -1, 'dB'), P('gain', 'Input gain', 0, 18, 0.5, 0, 'dB'), P('release', 'Release', 10, 500, 5, 80, 'ms'),
  ] },
};

export const FX_TYPES = Object.keys(FX_DEFS) as FxType[];

let fxCounter = 0;
export function newEffect(type: FxType, params: Record<string, number> = {}, id?: string): Effect {
  const def: Record<string, number> = {};
  for (const p of FX_DEFS[type].params) def[p.key] = p.def;
  return { id: id ?? type + '-' + Date.now().toString(36) + '-' + (fxCounter++).toString(36), type, params: { ...def, ...params } };
}

/** Delay time (s) for a tempo-synced delay. */
export function delaySeconds(noteIndex: number, bpm: number): number {
  const q = DELAY_NOTE_QUARTERS[Math.max(0, Math.min(DELAY_NOTE_QUARTERS.length - 1, Math.round(noteIndex)))];
  return (q * 60) / Math.max(20, bpm);
}

// ---------------------------------------------------------------- presets

export interface FxPreset {
  name: string;
  /** Instrument family it is meant for (for sorting the list). */
  family: 'guitar' | 'bass' | 'drums' | 'vocal' | 'keys' | 'any';
  fx: { type: FxType; params?: Record<string, number> }[];
  sends?: { reverb?: number; delay?: number };
}

export const FX_PRESETS: FxPreset[] = [
  { name: 'Clean guitar', family: 'guitar', fx: [
    { type: 'comp', params: { threshold: -20, ratio: 3, makeup: 3 } },
    { type: 'amp', params: { gain: 0.15, bass: 1, mid: 0, treble: 2, cab: 1, level: -4 } },
    { type: 'chorus', params: { rate: 0.6, depth: 0.35, mix: 0.3 } },
  ], sends: { reverb: 0.25 } },
  { name: 'Crunch', family: 'guitar', fx: [
    { type: 'drive', params: { drive: 0.35, tone: 3500, mode: 0, level: -6 } },
    { type: 'amp', params: { gain: 0.5, bass: 2, mid: 2, treble: 1, cab: 0, level: -8 } },
  ], sends: { reverb: 0.15 } },
  { name: 'Lead', family: 'guitar', fx: [
    { type: 'drive', params: { drive: 0.6, tone: 4000, mode: 1, level: -8 } },
    { type: 'amp', params: { gain: 0.75, bass: 1, mid: 4, treble: 2, presence: 2, cab: 0, level: -10 } },
  ], sends: { reverb: 0.2, delay: 0.25 } },
  { name: 'Metal rhythm', family: 'guitar', fx: [
    { type: 'gate', params: { threshold: -45 } },
    { type: 'drive', params: { drive: 0.8, tone: 5000, mode: 1, level: -10 } },
    { type: 'amp', params: { gain: 0.85, bass: 4, mid: -4, treble: 3, cab: 0, level: -12 } },
  ] },
  { name: 'Bass DI', family: 'bass', fx: [
    { type: 'comp', params: { threshold: -22, ratio: 4, attack: 15, release: 120, makeup: 4 } },
    { type: 'eq3', params: { low: 3, lowFreq: 90, mid: -2, midFreq: 400, high: 1, highFreq: 3000 } },
  ] },
  { name: 'Bass drive', family: 'bass', fx: [
    { type: 'comp', params: { threshold: -20, ratio: 4, makeup: 3 } },
    { type: 'bassamp', params: { gain: 0.6, bass: 3, mid: 2, treble: 1, cab: 3, blend: 0.4, level: -6 } },
  ] },
  { name: 'Drum room', family: 'drums', fx: [
    { type: 'comp', params: { threshold: -16, ratio: 3, attack: 5, release: 100, makeup: 3 } },
    { type: 'eq3', params: { low: 2, lowFreq: 80, mid: -2, midFreq: 500, high: 2, highFreq: 6000 } },
    { type: 'reverb', params: { type: 0, decay: 0.8, predelay: 5, mix: 0.18 } },
  ] },
  { name: 'Vocal plate', family: 'vocal', fx: [
    { type: 'peq', params: { lowCut: 90, highCut: 18000, freq: 300, gain: -2, q: 1, freq2: 3500, gain2: 2.5, q2: 1 } },
    { type: 'comp', params: { threshold: -20, ratio: 3.5, attack: 5, makeup: 4 } },
    { type: 'reverb', params: { type: 2, decay: 2.2, predelay: 25, mix: 0.25 } },
  ] },
  { name: 'Warm keys', family: 'keys', fx: [
    { type: 'eq3', params: { low: 1, mid: -1, high: -2 } },
    { type: 'chorus', params: { rate: 0.4, depth: 0.3, mix: 0.25 } },
  ], sends: { reverb: 0.3 } },
  { name: 'Tremolo keys', family: 'keys', fx: [{ type: 'tremolo', params: { rate: 5, depth: 0.5 } }], sends: { reverb: 0.3 } },
];

export function presetEffects(p: FxPreset): Effect[] {
  return p.fx.map((f) => newEffect(f.type, f.params));
}

// ---------------------------------------------------------------- automation

export interface AutoPoint {
  bar: number;
  /** Offset in the bar (model ticks). */
  tick: number;
  value: number;
}

export interface AutoLane {
  /** 'volume' (fader 0..1), 'pan' (-1..1) or 'fx:<effectId>:<param>'. */
  param: string;
  points: AutoPoint[];
}

/** Absolute model tick of a bar/tick position. */
export function absTick(song: Song, bar: number, tick: number): number {
  const starts = barStartTicks(song);
  return (starts[Math.max(0, Math.min(starts.length - 1, bar))] ?? 0) + tick;
}

/** Points sorted by time with absolute ticks. */
export function lanePoints(song: Song, lane: AutoLane): { t: number; v: number }[] {
  return lane.points.map((p) => ({ t: absTick(song, p.bar, p.tick), v: p.value })).sort((a, b) => a.t - b.t);
}

/** Value of a lane at an absolute model tick: linear between points, held before the first / after the last. */
export function laneValueAt(pts: { t: number; v: number }[], t: number): number | undefined {
  if (!pts.length) return undefined;
  if (t <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (pts[i + 1].t <= t) i++;
  const a = pts[i];
  const b = pts[i + 1];
  return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/** Range of a lane's parameter (for drawing and clamping). */
export function laneRange(track: Track, param: string): { min: number; max: number; name: string } {
  if (param === 'volume') return { min: 0, max: 1, name: 'Volume' };
  if (param === 'pan') return { min: -1, max: 1, name: 'Pan' };
  const [, id, key] = param.split(':');
  const fx = track.mixer.fx?.find((f) => f.id === id);
  const def = fx && FX_DEFS[fx.type].params.find((p) => p.key === key);
  if (!fx || !def) return { min: 0, max: 1, name: param };
  return { min: def.min, max: def.max, name: FX_DEFS[fx.type].name + ' ' + def.name };
}

// ---------------------------------------------------------------- song-level mix

export interface BusSettings {
  /** Return level (fader position 0..1, 0.8 = 0 dB). */
  volume: number;
  mute?: boolean;
  fx: Effect;
}

export interface MasterSettings {
  volume: number;
  fx: Effect[];
}

export interface SongMix {
  master: MasterSettings;
  reverb: BusSettings;
  delay: BusSettings;
}

export function defaultSongMix(): SongMix {
  return {
    master: { volume: 0.8, fx: [newEffect('limiter', {}, 'master-limiter')] },
    reverb: { volume: 0.8, fx: { ...newEffect('reverb', { type: 1, decay: 2.2, predelay: 15, mix: 1 }, 'bus-reverb') } },
    delay: { volume: 0.8, fx: { ...newEffect('delay', { note: 2, feedback: 0.35, mix: 1, tone: 4500 }, 'bus-delay') } },
  };
}

export function songMix(song: Song): SongMix {
  return song.mix ?? defaultSongMix();
}

// ---------------------------------------------------------------- audio clips

export interface AudioClip {
  id: string;
  name: string;
  /** Media file: absolute path, or relative to the project's `<name>_media` folder. */
  file: string;
  /** Musical position: stays at its bar when the tempo changes. */
  bar: number;
  tick: number;
  /** Trim: where in the source the clip starts (ms) and how long it plays (ms). */
  startMs: number;
  lengthMs: number;
  /** Length of the whole source file (ms). */
  sourceMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  gainDb: number;
}

/** Split a clip at a time (ms from the clip's start). Returns the two halves, or null if outside. */
export function splitClip(song: Song, clip: AudioClip, atMs: number, msToBarTick: (ms: number) => { bar: number; tick: number }, clipStartMs: number): [AudioClip, AudioClip] | null {
  if (atMs <= 0 || atMs >= clip.lengthMs) return null;
  void song;
  const pos = msToBarTick(clipStartMs + atMs);
  const a: AudioClip = { ...clip, lengthMs: atMs, fadeOutMs: Math.min(clip.fadeOutMs, 10) };
  const b: AudioClip = {
    ...clip, id: clip.id + 'b' + Math.round(atMs), bar: pos.bar, tick: pos.tick, startMs: clip.startMs + atMs,
    lengthMs: clip.lengthMs - atMs, fadeInMs: Math.min(clip.fadeInMs, 10),
  };
  return [a, b];
}

/** Gain envelope of a clip at a time inside it (fades are linear), times clip gain. */
export function clipGainAt(clip: AudioClip, ms: number): number {
  if (ms < 0 || ms > clip.lengthMs) return 0;
  let g = dbToGain(clip.gainDb);
  if (clip.fadeInMs > 0 && ms < clip.fadeInMs) g *= ms / clip.fadeInMs;
  const left = clip.lengthMs - ms;
  if (clip.fadeOutMs > 0 && left < clip.fadeOutMs) g *= left / clip.fadeOutMs;
  return g;
}

export const isAudioTrack = (t: Track) => !!t.audio;

/** Ticks per bar helper used by clip/automation UIs. */
export function barLengthTicks(song: Song, bar: number): number {
  const ts = song.bars[bar]?.timeSignature ?? { numerator: 4, denominator: 4 };
  return (ts.numerator * PPQ * 4) / ts.denominator;
}
