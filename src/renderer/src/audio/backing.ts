// Backing track: a recording (e.g. a Rocksmith song's audio) that plays in sync with the score.
// An <audio> element follows the alphaTab player position: seek on start/jumps, re-seek when it
// drifts more than DRIFT_MS. Its sound goes through the master bus (so --mute silences it too).
import { msAtTick, tempoPoints, type TempoPoint } from '../../../model/tempo';
import type { BackingTrack, Song } from '../../../model/types';
import type { PlayerStatus, ScorePlayer } from '../player';

const DRIFT_MS = 120;

export interface BackingStatus {
  loaded: boolean;
  path: string | null;
  playing: boolean;
  /** Audio position minus where the score says it should be (ms), last measured while playing. */
  driftMs: number | null;
  error: string | null;
}

export class BackingPlayer {
  private audio = new Audio();
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private url: string | null = null;
  private track: BackingTrack | null = null;
  private pts: TempoPoint[] = [];
  private speed = 1;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTick = -1;
  status: BackingStatus = { loaded: false, path: null, playing: false, driftMs: null, error: null };

  constructor(private readonly player: ScorePlayer) {
    this.audio.preload = 'auto';
    player.on((s) => this.follow(s));
  }

  private ensureGraph() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaElementSource(this.audio);
    this.gain = this.ctx.createGain();
    src.connect(this.gain);
    this.gain.connect(this.ctx.destination); // -> master bus (see masterBus.ts)
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.gain || !this.track) return;
    this.gain.gain.value = this.track.mute ? 0 : this.track.volume;
  }

  /** Follow the song: load/unload the recording, volume/mute, tempo map. */
  async setSong(song: Song | null) {
    const b = song?.backing ?? null;
    if (song) this.pts = tempoPoints(song);
    const pathChanged = (b?.path ?? null) !== this.status.path;
    this.track = b ? { ...b } : null;
    this.applyVolume();
    if (!pathChanged) return;
    this.stopAudio();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.status = { loaded: false, path: b?.path ?? null, playing: false, driftMs: null, error: null };
    if (!b) return;
    try {
      const f = await window.mg.readFile(b.path);
      const ext = b.path.toLowerCase().split('.').pop();
      const type = ext === 'ogg' ? 'audio/ogg' : ext === 'mp3' ? 'audio/mpeg' : ext === 'flac' ? 'audio/flac' : 'audio/wav';
      this.url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type }));
      this.audio.src = this.url;
      await new Promise<void>((resolve, reject) => {
        this.audio.oncanplaythrough = () => resolve();
        this.audio.onerror = () => reject(new Error('cannot decode ' + b.path));
      });
      this.ensureGraph();
      this.status = { ...this.status, loaded: true };
    } catch (e) {
      this.status = { ...this.status, error: (e as Error).message };
    }
  }

  setSpeed(pct: number) {
    this.speed = pct / 100;
    this.audio.playbackRate = this.speed;
  }

  /** Where the recording should be (seconds) at a score tick. */
  expectedSeconds(tick: number): number {
    return ((this.track?.offsetMs ?? 0) + msAtTick(this.pts, tick)) / 1000;
  }

  private stopAudio() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    if (!this.audio.paused) this.audio.pause();
    this.status = { ...this.status, playing: false };
  }

  private follow(s: PlayerStatus) {
    if (!this.track || !this.status.loaded) return;
    const want = this.expectedSeconds(s.tick);
    if (!s.playing) {
      this.stopAudio();
      if (s.tick !== this.lastTick && want >= 0) this.audio.currentTime = Math.min(want, this.audio.duration || want);
      this.lastTick = s.tick;
      return;
    }
    this.lastTick = s.tick;
    this.ctx?.resume().catch(() => {});
    if (this.audio.paused && !this.startTimer) {
      if (want < 0) {
        // Bar 1 comes before the recording starts: wait for it.
        this.startTimer = setTimeout(() => {
          this.startTimer = null;
          this.audio.currentTime = 0;
          void this.audio.play();
        }, (-want * 1000) / this.speed);
      } else if (want < (this.audio.duration || Infinity)) {
        this.audio.currentTime = want;
        this.audio.playbackRate = this.speed;
        void this.audio.play();
      }
      this.status = { ...this.status, playing: true };
      return;
    }
    if (!this.audio.paused && want >= 0) {
      const drift = (this.audio.currentTime - want) * 1000;
      this.status = { ...this.status, playing: true, driftMs: Math.round(drift) };
      if (Math.abs(drift) > DRIFT_MS) this.audio.currentTime = want;
    }
  }

  /** For tests: the audio element's position and the expected one now. */
  probe() {
    return {
      audioSeconds: this.audio.currentTime,
      expectedSeconds: this.expectedSeconds(this.player.api.tickPosition),
      paused: this.audio.paused,
      duration: this.audio.duration,
    };
  }
}
