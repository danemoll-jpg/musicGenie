// Audio clips on audio tracks: decoded media cache and live scheduling. A clip sits at a bar/tick,
// so it stays on its bar when the tempo changes. Live playback starts each clip when the heard
// position passes its bar (every pass through repeats/loops), or mid-clip after a seek.
import { clipGainAt, dbToGain, type AudioClip, type Song } from '../../../model';
import type { Engine } from './engine';

const decoded = new Map<string, Promise<AudioBuffer>>();
let resolver: (file: string) => string = (f) => f;

/** How clip file names (relative to the project's media folder) become paths. */
export function setMediaResolver(fn: (file: string) => string) {
  resolver = fn;
}
export function mediaPath(file: string): string {
  return resolver(file);
}

/** Decode a media file once (WAV/MP3/OGG/FLAC). */
export function loadMedia(ctx: BaseAudioContext, file: string): Promise<AudioBuffer> {
  const path = mediaPath(file);
  let p = decoded.get(path);
  if (!p) {
    p = window.mg.readFile(path).then((f) => ctx.decodeAudioData(f.bytes.slice().buffer as ArrayBuffer));
    decoded.set(path, p);
    p.catch(() => decoded.delete(path));
  }
  return p;
}
/** A buffer made in the app (a recording) under a file name. */
export function putMedia(file: string, buf: AudioBuffer) {
  decoded.set(mediaPath(file), Promise.resolve(buf));
}

/** Schedule a clip into `dest` so that clip time `fromMs` plays at context time `when`. */
export function startClip(ctx: BaseAudioContext, buf: AudioBuffer, clip: AudioClip, dest: AudioNode, when: number, fromMs: number): AudioBufferSourceNode | null {
  const left = clip.lengthMs - fromMs;
  if (left <= 5) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  src.connect(g).connect(dest);
  // Envelope: clip gain with linear fades, written as ramps from where playback starts.
  const pts: number[] = [fromMs];
  if (clip.fadeInMs > fromMs) pts.push(clip.fadeInMs);
  if (clip.fadeOutMs > 0) pts.push(Math.max(fromMs, clip.lengthMs - clip.fadeOutMs));
  pts.push(clip.lengthMs);
  g.gain.setValueAtTime(clipGainAt(clip, fromMs) || (fromMs === 0 && clip.fadeInMs > 0 ? 0 : dbToGain(clip.gainDb)), when);
  for (const ms of pts.slice(1)) g.gain.linearRampToValueAtTime(clipGainAt(clip, Math.min(ms, clip.lengthMs - 0.01)), when + (ms - fromMs) / 1000);
  src.start(when, (clip.startMs + fromMs) / 1000, left / 1000);
  return src;
}

/** Live clip playback that follows the engine's heard position. */
export class ClipPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = new Map<string, AudioBufferSourceNode>();
  private lastMs = -1;
  private song: Song | null = null;
  /** Playback occurrences of a model bar (tick at its start), from the player. */
  occurrences: (bar: number) => number[] = () => [];
  started = 0;

  constructor(private engine: Engine) {}

  setSong(song: Song) {
    this.song = song;
    const any = song.tracks.some((t) => t.audio?.clips.length);
    if (any) {
      for (const t of song.tracks) for (const c of t.audio?.clips ?? []) void loadMedia(this.engine.ctx, c.file).catch(() => {});
      if (!this.timer) this.timer = setInterval(() => this.tick(), 40);
    } else this.stopAll();
  }

  stopAll() {
    for (const s of this.playing.values()) try { s.stop(); } catch { /* done */ }
    this.playing.clear();
  }

  private tick() {
    const e = this.engine;
    const song = this.song;
    if (!song || !e.playingMain) {
      if (this.playing.size) this.stopAll();
      this.lastMs = -1;
      return;
    }
    const now = e.ctx.currentTime;
    const ms = e.synthMsAt(now);
    // A jump (seek, loop restart) restarts everything from the new position.
    if (this.lastMs >= 0 && (ms < this.lastMs - 5 || ms > this.lastMs + 400)) this.stopAll();
    const ahead = 150;
    for (const t of song.tracks) {
      if (!t.audio) continue;
      const strip = e.graph.strip(t.id);
      if (!strip) continue;
      for (const c of t.audio.clips) {
        for (const occTick of this.occurrences(c.bar)) {
          const startMs = e.msAtPlayTick(occTick + c.tick);
          const key = c.id + '@' + occTick;
          if (this.playing.has(key)) continue;
          const into = ms - startMs; // ms of the clip already passed
          if (into > c.lengthMs - 10 || startMs > ms + ahead) continue;
          const p = loadMedia(e.ctx, c.file);
          // Mark first so it is not scheduled twice while decoding.
          this.playing.set(key, null as unknown as AudioBufferSourceNode);
          void p.then((buf) => {
            if (!this.playing.has(key)) return;
            const t2 = e.ctx.currentTime;
            const ms2 = e.synthMsAt(t2);
            const from = Math.max(0, ms2 - startMs);
            const when = from > 0 ? t2 : t2 + (startMs - ms2) / 1000;
            const src = startClip(e.ctx, buf, c, strip.input, when, from);
            if (src) {
              this.playing.set(key, src);
              this.started++;
              src.onended = () => { if (this.playing.get(key) === src) this.playing.delete(key); };
            } else this.playing.delete(key);
          }).catch(() => this.playing.delete(key));
        }
      }
    }
    this.lastMs = ms;
  }
}
