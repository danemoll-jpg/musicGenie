// Audio tracks (Round 5): import files as clips, record takes from an audio input, place them.
import { addAudioTrack, addClip, msToPos, posToMs, type AudioClip } from '../../model';
import { engine } from './audio/engine';
import { loadMedia, putMedia } from './audio/clips';
import { recorder, takeToWav } from './audio/recorder';
import type { ScorePlayer } from './player';
import type { Store } from './store';

export interface TakeResult {
  trackId: string;
  clip: AudioClip;
  /** Song time (ms) where the take's first kept sample sounds, and the latency that was applied. */
  clipStartMs: number;
  latencyMs: number;
  recordedMs: number;
}

const newId = (p: string) => p + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

export class AudioTracks {
  private rec: { trackId: string; startBar: number; practice: { countIn: boolean; metronome: boolean } } | null = null;

  constructor(private store: Store, private player: () => ScorePlayer | null) {}

  /** Add an audio track; returns its id. */
  addTrack(name?: string): string | null {
    let id: string | null = null;
    this.store.edit((s) => {
      const r = addAudioTrack(s, name);
      id = r.id;
      return r.song;
    }, 'Add audio track');
    const song = this.store.state.song;
    if (id && song) this.store.setSelTrack(song.tracks.findIndex((t) => t.id === id));
    return id;
  }

  /** The selected track if it is an audio track, else a new one. */
  private target(trackId?: string | null): string | null {
    const song = this.store.state.song;
    if (!song) return null;
    if (trackId && song.tracks.some((t) => t.id === trackId && t.audio)) return trackId;
    const sel = song.tracks[this.store.state.selTrack];
    return sel?.audio ? sel.id : this.addTrack();
  }

  /** Import a WAV/MP3/OGG/FLAC file as a clip at a bar. */
  async importFile(path?: string | null, trackId?: string | null, bar = 0): Promise<AudioClip | null> {
    const p = path ?? (await window.mg.pickFile('Import audio', [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }]));
    if (!p) return null;
    let buf: AudioBuffer;
    try {
      buf = await loadMedia(engine.ctx, p);
    } catch (e) {
      this.store.showError('Could not read that audio file: ' + (e as Error).message);
      return null;
    }
    const id = this.target(trackId);
    if (!id) return null;
    const ms = (buf.length / buf.sampleRate) * 1000;
    const clip: AudioClip = {
      id: newId('clip'), name: p.split(/[\\/]/).pop() ?? 'audio', file: p, bar, tick: 0,
      startMs: 0, lengthMs: ms, sourceMs: ms, fadeInMs: 0, fadeOutMs: 0, gainDb: 0,
    };
    this.store.edit((s) => addClip(s, id, clip), 'Import audio');
    return clip;
  }

  get recording() {
    return !!this.rec;
  }

  /** Arm and start: count-in (optional), metronome (optional), recording from `startBar`. */
  async startRecording(opts: { trackId?: string | null; startBar: number; countIn: boolean; metronome: boolean }) {
    const player = this.player();
    if (!player || !this.store.state.song) throw new Error('Open a song first.');
    if (!recorder.state.open) throw new Error('Choose an audio input first.');
    const trackId = this.target(opts.trackId);
    if (!trackId) throw new Error('No audio track.');
    const practice = { countIn: this.store.state.practice.countIn, metronome: this.store.state.practice.metronome };
    this.rec = { trackId, startBar: opts.startBar, practice };
    this.store.setPractice({ countIn: opts.countIn, metronome: opts.metronome });
    player.setCountIn(opts.countIn);
    player.setMetronome(opts.metronome);
    player.pause();
    player.seekBar(opts.startBar);
    engine.anchorLog = [];
    await engine.ctx.resume();
    recorder.start();
    player.play();
  }

  /** Stop and place the take on the armed track (one undo step). */
  async stopRecording(): Promise<TakeResult | null> {
    const r = this.rec;
    const player = this.player();
    if (!r || !player) return null;
    this.rec = null;
    player.pause();
    const take = await recorder.stop();
    const anchors = engine.anchorLog ?? [];
    engine.anchorLog = null;
    this.store.setPractice(r.practice);
    const song = this.store.state.song;
    if (!take || !song) return null;
    if (!anchors.length) {
      this.store.showError('Nothing recorded after the count-in.');
      return null;
    }
    // The player clock: synth time A.synthMs was heard at context time A.ctxTime.
    const A = anchors[0];
    const sr = take.sampleRate;
    const lat = recorder.state.latencyMs / 1000;
    const startPlayMs = engine.msAtPlayTick(player.barStartTick(r.startBar));
    // Context frame where the start bar's sound arrives back at the input.
    const frameAtStart = Math.round((A.ctxTime + (startPlayMs - A.synthMs) / 1000 + lat) * sr);
    const i0 = frameAtStart - take.firstFrame;
    const keepFrom = Math.max(0, i0);
    const frames = take.L.length;
    if (frames - keepFrom < sr * 0.05) {
      this.store.showError('The take was too short.');
      return null;
    }
    const barMs = posToMs(song, r.startBar, 0);
    const clipStartMs = barMs + (i0 < 0 ? (-i0 / sr) * 1000 : 0);
    const pos = i0 < 0 ? msToPos(song, clipStartMs) : { bar: r.startBar, tick: 0 };
    const { userData } = await window.mg.paths();
    const file = userData + '\\media\\take-' + new Date().toISOString().replace(/[:.]/g, '-') + '.wav';
    await window.mg.writeBytes(file, takeToWav(take.L, take.R, sr));
    const ab = engine.ctx.createBuffer(2, frames, sr);
    ab.copyToChannel(take.L as Float32Array<ArrayBuffer>, 0);
    ab.copyToChannel(take.R as Float32Array<ArrayBuffer>, 1);
    putMedia(file, ab);
    const sourceMs = (frames / sr) * 1000;
    const clip: AudioClip = {
      id: newId('take'), name: 'Take ' + new Date().toLocaleTimeString(), file, ...pos,
      startMs: (keepFrom / sr) * 1000, lengthMs: ((frames - keepFrom) / sr) * 1000, sourceMs,
      fadeInMs: 0, fadeOutMs: 0, gainDb: 0,
    };
    this.store.edit((s) => addClip(s, r.trackId, clip), 'Record audio');
    return { trackId: r.trackId, clip, clipStartMs, latencyMs: recorder.state.latencyMs, recordedMs: sourceMs };
  }
}
