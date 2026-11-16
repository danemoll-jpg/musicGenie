// Audio tracks and clips (Round 5), pure. A clip sits on a bar/tick, so it keeps its musical
// position when the tempo changes (its audio is not stretched).
import { newTrack } from './factory';
import type { AudioClip } from './mix';
import { restMeasure } from './noteEdit';
import { msAtTick, tempoPoints, tickAtMs } from './tempo';
import { barStartTicks } from './timing';
import type { Song } from './types';

/** Song position (ms from bar 1, tempo map, no repeats) of a bar/tick. */
export function posToMs(song: Song, bar: number, tick: number): number {
  const starts = barStartTicks(song);
  return msAtTick(tempoPoints(song), (starts[Math.max(0, Math.min(starts.length - 1, bar))] ?? 0) + tick);
}

/** Bar/tick at a song time (ms), on a grid of `snap` ticks (0 = exact). */
export function msToPos(song: Song, ms: number, snap = 0): { bar: number; tick: number } {
  let t = tickAtMs(tempoPoints(song), Math.max(0, ms));
  if (snap > 0) t = Math.round(t / snap) * snap;
  t = Math.round(t);
  const starts = barStartTicks(song);
  let bar = 0;
  while (bar + 1 < starts.length && starts[bar + 1] <= t) bar++;
  return { bar, tick: t - starts[bar] };
}

export function clipStartMs(song: Song, c: AudioClip): number {
  return posToMs(song, c.bar, c.tick);
}

/** Add an empty audio track (its staff stays rests, hidden in the score). Returns the new song and id. */
export function addAudioTrack(song: Song, name?: string): { song: Song; id: string } {
  let n = 1;
  let id = 'audio1';
  while (song.tracks.some((t) => t.id === id)) id = 'audio' + ++n;
  const t = newTrack(id, name ?? 'Audio ' + n, 0, false, [{ clef: 'treble', measures: song.bars.map((b) => restMeasure(b)) }]);
  t.display.visible = false;
  t.audio = { clips: [] };
  return { song: { ...song, tracks: [...song.tracks, t] }, id };
}

const mapClips = (song: Song, trackId: string, fn: (clips: AudioClip[]) => AudioClip[]): Song => ({
  ...song,
  tracks: song.tracks.map((t) => (t.id === trackId && t.audio ? { ...t, audio: { ...t.audio, clips: fn(t.audio.clips) } } : t)),
});

export function addClip(song: Song, trackId: string, clip: AudioClip): Song {
  return mapClips(song, trackId, (c) => [...c, clip]);
}
export function updateClip(song: Song, trackId: string, clipId: string, patch: Partial<AudioClip>): Song {
  return mapClips(song, trackId, (cs) => cs.map((c) => (c.id === clipId ? { ...c, ...patch } : c)));
}
export function removeClip(song: Song, trackId: string, clipId: string): Song {
  return mapClips(song, trackId, (cs) => cs.filter((c) => c.id !== clipId));
}

/** Trim the clip's start to song time `atMs` (later = cut the beginning, earlier = reveal more source). */
export function trimClipStart(song: Song, c: AudioClip, atMs: number): Partial<AudioClip> {
  const start = clipStartMs(song, c);
  const delta = Math.max(-c.startMs, Math.min(c.lengthMs - 10, atMs - start));
  const pos = msToPos(song, start + delta);
  return { ...pos, startMs: c.startMs + delta, lengthMs: c.lengthMs - delta, fadeInMs: Math.min(c.fadeInMs, c.lengthMs - delta) };
}
/** Trim the clip's end to song time `atMs`. */
export function trimClipEnd(song: Song, c: AudioClip, atMs: number): Partial<AudioClip> {
  const start = clipStartMs(song, c);
  const len = Math.max(10, Math.min(c.sourceMs - c.startMs, atMs - start));
  return { lengthMs: len, fadeOutMs: Math.min(c.fadeOutMs, len) };
}

/** Split a clip at song time `atMs` into two clips. Returns the song unchanged if outside the clip. */
export function splitClipAtMs(song: Song, trackId: string, clipId: string, atMs: number): Song {
  const t = song.tracks.find((x) => x.id === trackId);
  const c = t?.audio?.clips.find((x) => x.id === clipId);
  if (!c) return song;
  const into = atMs - clipStartMs(song, c);
  if (into <= 5 || into >= c.lengthMs - 5) return song;
  const a: AudioClip = { ...c, lengthMs: into, fadeOutMs: Math.min(c.fadeOutMs, 5) };
  const pos = msToPos(song, atMs);
  let id = c.id + '-b';
  while (t!.audio!.clips.some((x) => x.id === id)) id += 'b';
  const b: AudioClip = { ...c, id, ...pos, startMs: c.startMs + into, lengthMs: c.lengthMs - into, fadeInMs: Math.min(c.fadeInMs, 5) };
  return mapClips(song, trackId, (cs) => cs.flatMap((x) => (x.id === clipId ? [a, b] : [x])));
}

// ------------------------------------------------------------- media folder

const norm = (p: string) => p.replace(/\//g, '\\');
const isAbs = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');

/** `<dir>\<name>_media` for a project path. */
export function mediaDirFor(projectPath: string): string {
  const p = norm(projectPath);
  const dir = p.slice(0, p.lastIndexOf('\\'));
  const base = p.slice(p.lastIndexOf('\\') + 1).replace(/\.[^.]+$/, '');
  return dir + '\\' + base + '_media';
}

/** Clip files inside the media folder become relative (for saving). */
export function relativizeMedia(song: Song, mediaDir: string): Song {
  const md = norm(mediaDir).toLowerCase() + '\\';
  if (!song.tracks.some((t) => t.audio?.clips.length)) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) => (t.audio ? {
      ...t, audio: { ...t.audio, clips: t.audio.clips.map((c) => (norm(c.file).toLowerCase().startsWith(md) ? { ...c, file: norm(c.file).slice(md.length) } : c)) },
    } : t)),
  };
}

/** Relative clip files (as saved) become paths in the media folder (after opening). */
export function absolutizeMedia(song: Song, mediaDir: string): Song {
  if (!song.tracks.some((t) => t.audio?.clips.length)) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) => (t.audio ? {
      ...t, audio: { ...t.audio, clips: t.audio.clips.map((c) => (isAbs(c.file) ? c : { ...c, file: norm(mediaDir) + '\\' + norm(c.file) })) },
    } : t)),
  };
}

/** Every media file the song uses. */
export function mediaFiles(song: Song): string[] {
  return [...new Set(song.tracks.flatMap((t) => t.audio?.clips.map((c) => c.file) ?? []))];
}
