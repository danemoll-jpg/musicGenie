// Round 6 renderer side of the analysis jobs: models (ask + download with a progress bar), one job
// at a time in the background worker with progress and Cancel, temporary audio files.
import type { MlModelStatus, MlProgress } from '../../preload';
import {
  addAudioTrack, addClip, addDrumTranscription, placeWords, recToSongMs, clipStartMs, addTranscribedTrack, defaultBar, emptySong, mediaDirFor, songGridFromBeats, PART_KINDS,
  type AudioClip, type AudioNote, type DrumHitIn, type RocksmithExport, type Song, type Track,
} from '../../model';
import { engine } from './audio/engine';
import { loadMedia, mediaPath } from './audio/clips';
import { wavBytes } from './audio/render';
import type { Store } from './store';

export interface JobState {
  title: string;
  stage: string;
  done: number;
  total: number;
  startedAt: number;
}

export interface AnalysisState {
  job: JobState | null;
  models: MlModelStatus[];
  /** Last runtime probe (item 1). */
  runtime: { provider: string; gpu: string | null; runMs: number; cpuRunMs: number | null; ortVersion: string } | null;
  lastError: string | null;
  /** "Song to Rocksmith" steps the user ran or skipped (reset with a new recording). */
  wizard: { beats?: 'done' | 'skipped'; stems?: 'done' | 'skipped'; notes?: 'done' | 'skipped'; review?: 'done' };
}

type L = (s: AnalysisState) => void;

export class Analysis {
  state: AnalysisState = { job: null, models: [], runtime: null, lastError: null, wizard: {} };
  private listeners = new Set<L>();
  /** Tests: accept download questions without the dialog. */
  autoAccept = false;
  private temps = new Set<string>();

  constructor(private store: Store) {
    window.mg.onMlProgress((p: MlProgress) => {
      if (!this.state.job) return;
      this.set({ job: { ...this.state.job, stage: p.stage, done: p.done, total: p.total } });
    });
    void this.refreshModels();
  }

  on(fn: L) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(p: Partial<AnalysisState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f(this.state));
  }

  async refreshModels() {
    this.set({ models: await window.mg.mlModels() });
    return this.state.models;
  }

  setWizard(p: AnalysisState['wizard']) {
    this.set({ wizard: { ...this.state.wizard, ...p } });
  }

  get busy() {
    return !!this.state.job;
  }

  /** Make sure the models are on disk: ask once (sizes + licences), then download. */
  async ensureModels(ids: string[]): Promise<boolean> {
    const models = await this.refreshModels();
    const missing = models.filter((m) => ids.includes(m.id) && !m.installed);
    if (!missing.length) return true;
    const mb = (b: number) => (b / 1e6).toFixed(b < 1e6 ? 2 : 0) + ' MB';
    const text = 'This needs ' + missing.map((m) => `${m.title} (${mb(m.bytes)}, licence: ${m.short})`).join(', ') +
      '. Download now into the app\'s data folder? It is only downloaded once.';
    const ok = this.autoAccept || (await this.store.askAsync(text, 'Download'));
    if (!ok) return false;
    for (const m of missing) {
      await this.withJob('Downloading ' + m.title, () => window.mg.mlDownload(m.id));
    }
    await this.refreshModels();
    return true;
  }

  async withJob<T>(title: string, fn: () => Promise<T>): Promise<T> {
    if (this.state.job) throw new Error('Another job is running: ' + this.state.job.title);
    this.set({ job: { title, stage: 'starting', done: 0, total: 1, startedAt: performance.now() }, lastError: null });
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      this.set({ lastError: msg });
      throw new Error(msg);
    } finally {
      this.set({ job: null });
    }
  }

  cancel() {
    void window.mg.mlCancel();
  }

  async modelFile(id: string, file: string) {
    return window.mg.mlModelPath(id, file);
  }

  /** A WAV path the worker can read for this media file (WAV passes straight through). */
  async wavFor(file: string): Promise<string> {
    if (/\.wav$/i.test(file)) return file;
    const buf = await loadMedia(engine.ctx, file);
    return this.writeTemp(buf);
  }

  async writeTemp(buf: AudioBuffer): Promise<string> {
    const n = buf.length;
    const inter = new Float32Array(n * 2);
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    for (let i = 0; i < n; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
    const { userData } = await window.mg.paths();
    const path = `${userData}\\ml-temp\\a-${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}.wav`;
    await window.mg.writeBytes(path, wavBytes(inter, buf.sampleRate));
    this.temps.add(path);
    return path;
  }

  /** Remove temporary analysis audio. */
  async cleanTemp() {
    const { userData } = await window.mg.paths();
    this.temps.clear();
    return window.mg.removePaths([userData + '\\ml-temp']);
  }

  /** Item 1: the runtime check. Downloads basic-pitch (0.23 MB) and times it on GPU and CPU. */
  async probe() {
    if (!(await this.ensureModels(['basic-pitch']))) return null;
    const model = await this.modelFile('basic-pitch', 'nmp.onnx');
    const r = await this.withJob('Checking the ML runtime', () => window.mg.mlRun<Record<string, { ok: boolean; runMs?: number; loadMs?: number; error?: string }> & { ortVersion: string }>('probe', { model }));
    const info = await window.mg.mlInfo();
    const active = info.devices.find((d) => d.active) ?? info.devices[0];
    const vendor: Record<number, string> = { 0x10de: 'NVIDIA', 0x8086: 'Intel', 0x1002: 'AMD' };
    const gpu = active ? `${vendor[active.vendorId] ?? 'GPU'} 0x${active.deviceId.toString(16)} (driver ${active.driverVersion ?? '?'})` : null;
    const dml = r.dml;
    const cpu = r.cpu;
    const runtime = {
      provider: dml?.ok ? 'DirectML (GPU)' : 'CPU',
      gpu,
      runMs: (dml?.ok ? dml.runMs : cpu?.runMs) ?? -1,
      cpuRunMs: cpu?.ok ? cpu.runMs ?? null : null,
      ortVersion: r.ortVersion,
    };
    this.set({ runtime });
    return { ...runtime, raw: r, devices: info.devices, pid: info.pid };
  }
  // ------------------------------------------------------------------ actions on the song

  /** The original recording's clip (song.recording, else the selected/first audio clip). */
  recordingClip(song: Song | null = this.store.state.song): { track: Track; clip: AudioClip } | null {
    if (!song) return null;
    if (song.recording) {
      const t = song.tracks.find((x) => x.id === song.recording!.trackId);
      const c = t?.audio?.clips.find((x) => x.id === song.recording!.clipId);
      if (t && c) return { track: t, clip: c };
    }
    const sel = song.tracks[this.store.state.selTrack];
    const t = sel?.audio?.clips.length ? sel : song.tracks.find((x) => x.audio?.clips.length && !x.analysis);
    return t ? { track: t, clip: t.audio!.clips[0] } : null;
  }

  /** The first clip of an audio track. */
  clipOf(trackId: string): { track: Track; clip: AudioClip } | null {
    const t = this.store.state.song?.tracks.find((x) => x.id === trackId);
    return t?.audio?.clips.length ? { track: t, clip: t.audio.clips[0] } : null;
  }

  /** A new song around a recording: one audio track holding it, bars at 120 bpm until beats are found. */
  async newFromRecording(path?: string | null): Promise<boolean> {
    const p = path ?? (await window.mg.pickFile('Load a recording', [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }]));
    if (!p) return false;
    const buf = await loadMedia(engine.ctx, p);
    const ms = (buf.length / buf.sampleRate) * 1000;
    const file = p.split(/[\\/]/).pop() ?? 'recording';
    const name = file.replace(/\.[^.]+$/, '');
    let song = emptySong(name);
    song.bars = Array.from({ length: Math.max(1, Math.ceil(ms / 2000)) }, () => defaultBar());
    const r = addAudioTrack(song, 'Recording');
    const clip: AudioClip = { id: 'recording', name: file, file: p, bar: 0, tick: 0, startMs: 0, lengthMs: ms, sourceMs: ms, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 };
    song = addClip(r.song, r.id, clip);
    song.recording = { trackId: r.id, clipId: clip.id };
    this.store.load(song, null, name);
    this.store.setSelTrack(0);
    this.lastBeats = null;
    this.set({ wizard: {} });
    return true;
  }

  lastBeats: { beats: number[]; downbeats: number[] } | null = null;

  /** Item 2: beats + downbeats of the recording -> bars and tempo map (one undo step). */
  async detectBeats(opts: { numerator?: number; apply?: boolean } = {}) {
    const rc = this.recordingClip();
    if (!rc) throw new Error('Load a recording first (or select an audio track with a clip).');
    if (!(await this.ensureModels(['beat-this']))) return null;
    const wav = await this.wavFor(rc.clip.file);
    const model = await this.modelFile('beat-this', 'final0-v2.onnx');
    const r = await this.withJob('Finding beats', () => window.mg.mlRun<{ beats: number[]; downbeats: number[]; durationS: number; provider: string; inferMs: number }>('beats', { wav, model }));
    if (window.mg.flags.hidden) console.warn('[beats]', JSON.stringify({ ...r, beats: undefined, downbeats: undefined, wav }), r.beats.length, r.downbeats.length, r.provider, r.durationS, JSON.stringify(r.beats.slice(0, 6)));
    if (opts.apply !== false) {
      this.store.edit((s) => {
        const next = songGridFromBeats(s, rc.clip, r.beats, r.downbeats, opts.numerator);
        if (!next.recording) next.recording = { trackId: rc.track.id, clipId: rc.clip.id };
        return next;
      }, 'Detect beats');
      this.lastBeats = r;
      this.setWizard({ beats: 'done' });
    }
    return r;
  }

  /** Re-bar the last detection with a chosen time signature (beats per bar). */
  redoBeats(numerator: number) {
    const rc = this.recordingClip();
    const b = this.lastBeats;
    if (!rc || !b) return;
    // The recording clip may have been re-anchored since: detection times are recording times.
    this.store.edit((s) => songGridFromBeats(s, this.recordingClip(s)!.clip, b.beats, b.downbeats, numerator), 'Beats in ' + numerator + '/4');
  }

  async mediaDir(): Promise<string> {
    const fp = this.store.state.filePath;
    if (fp) return mediaDirFor(fp);
    const { userData } = await window.mg.paths();
    return userData + '\\media';
  }

  /** Item 3: split the recording (or an audio track's clip) into stems, one muted audio track each. */
  async separateStems(trackId?: string) {
    const rc = trackId ? this.clipOf(trackId) : this.recordingClip();
    if (!rc) throw new Error('Load a recording first.');
    if (!(await this.ensureModels(['demucs-6s']))) return null;
    const wav = await this.wavFor(rc.clip.file);
    const model = await this.modelFile('demucs-6s', 'htdemucs_6s.onnx');
    const config = await this.modelFile('demucs-6s', 'htdemucs_6s.json');
    const outDir = await this.mediaDir();
    const prefix = (rc.clip.name.replace(/\.[^.]+$/, '') || 'stem').replace(/[^\w.-]+/g, '_') + '-' + Date.now().toString(36);
    const r = await this.withJob('Splitting into stems', () => window.mg.mlRun<{ stems: { name: string; file: string; rms: number }[]; provider: string; seconds: number; audioSeconds: number }>('stems', { wav, model, config, outDir, prefix }));
    const ids: Record<string, string> = {};
    this.store.edit((s) => {
      let song = s;
      const src = this.clipOf(rc.track.id)?.clip ?? rc.clip;
      for (const st of r.stems) {
        const a = addAudioTrack(song, 'Stem: ' + st.name);
        song = addClip(a.song, a.id, { ...src, id: 'stem-' + st.name, name: st.name + '.wav', file: st.file, gainDb: 0 });
        song = {
          ...song,
          tracks: song.tracks.map((t) => (t.id === a.id ? { ...t, mixer: { ...t.mixer, mute: true }, analysis: { kind: 'stem' as const, stem: st.name, sourceTrackId: rc.track.id } } : t)),
        };
        ids[st.name] = a.id;
      }
      return song;
    }, 'Split into stems');
    return { ...r, trackIds: ids };
  }

  /** Item 4: transcribe an audio track's clip into a new note track. */
  async transcribe(trackId: string, opts: { kind: string; grid: string; loose: boolean; minPitch?: number; maxPitch?: number; onsetThresh?: number; frameThresh?: number; refine?: false | { cents?: boolean; octaves?: boolean; lines?: boolean; onsets?: boolean; tuning?: boolean } }) {
    const rc = this.clipOf(trackId);
    if (!rc) throw new Error('That track has no audio clip.');
    if (!(await this.ensureModels(['basic-pitch']))) return null;
    const wav = await this.wavFor(rc.clip.file);
    const model = await this.modelFile('basic-pitch', 'nmp.onnx');
    const kind = PART_KINDS.find((k) => k.id === opts.kind) ?? PART_KINDS[0];
    // Round 7: tuning offset, bass octaves, guitar lines vs chords, attack timing, tuning (all on unless refine: false).
    const part = kind.id === 'bass' || kind.id === 'guitar' || kind.id === 'lead' ? kind.id : 'other';
    const refine = opts.refine === false ? undefined : { part, cents: true, octaves: true, lines: true, onsets: true, tuning: true, ...(opts.refine ?? {}) };
    const r = await this.withJob('Audio to notes', () => window.mg.mlRun<{ notes: AudioNote[]; provider: string; inferMs: number; info: { cents?: number; tuning?: { name: string; tuning: number[] } } & Record<string, unknown> }>('transcribe', {
      wav, model, refine, opts: {
        minPitch: opts.minPitch ?? kind.range[0] - 1, maxPitch: opts.maxPitch ?? kind.range[1] + 1, onsetThresh: opts.onsetThresh, frameThresh: opts.frameThresh,
        retrigger: kind.mono && kind.id !== 'bass' ? 'strict' : 'weak',
      },
    }));
    let id = '';
    let count = 0;
    this.store.edit((s) => {
      const out = addTranscribedTrack(s, this.clipOf(trackId)!.clip, r.notes, { kind: opts.kind, grid: opts.grid, loose: opts.loose, sourceTrackId: trackId, tuning: r.info?.tuning?.tuning, centOffset: r.info?.cents });
      id = out.id;
      count = out.notes;
      return out.song;
    }, 'Audio to notes');
    return { trackId: id, notes: count, raw: r.notes, provider: r.provider, inferMs: r.inferMs, info: r.info };
  }

  /** Round 7 item 4: vocal stem (or any audio track) -> melody track (FCPE) + lyrics (Whisper). */
  async vocals(trackId: string, opts: { grid: string; loose: boolean; lyrics: boolean }) {
    const rc = this.clipOf(trackId);
    if (!rc) throw new Error('That track has no audio clip.');
    if (!(await this.ensureModels(opts.lyrics ? ['fcpe', 'whisper-base'] : ['fcpe']))) return null;
    const wav = await this.wavFor(rc.clip.file);
    const kind = PART_KINDS.find((k) => k.id === 'vocals')!;
    const model = await this.modelFile('fcpe', 'fcpe.onnx');
    const r = await this.withJob('Vocal melody', () => window.mg.mlRun<{ notes: AudioNote[]; centOffset: number; inferMs: number }>('voiceNotes', { wav, model, minPitch: kind.range[0] - 4, maxPitch: kind.range[1] + 4 }));
    let w: { words: { word: string; start: number; end: number; prob: number }[]; inferMs: number } | null = null;
    if (opts.lyrics) {
      const [encoder, decoder, vocab] = await Promise.all(['encoder_model_quantized.onnx', 'decoder_model_quantized.onnx', 'vocab.json'].map((f) => this.modelFile('whisper-base', f)));
      w = await this.withJob('Lyrics (speech to text)', () => window.mg.mlRun<{ words: { word: string; start: number; end: number; prob: number }[]; inferMs: number }>('whisper', { wav, encoder, decoder, vocab }));
    }
    let id = '';
    let count = 0;
    let placed = 0;
    this.store.edit((s) => {
      const clip = this.clipOf(trackId)!.clip;
      const out = addTranscribedTrack(s, clip, r.notes, { kind: 'vocals', grid: opts.grid, loose: opts.loose, sourceTrackId: trackId, name: 'Vocal melody' });
      id = out.id;
      count = out.notes;
      if (!w) return out.song;
      const pw = placeWords(out.song, id, w.words.map((x) => ({ word: x.word, ms: recToSongMs(out.song, clip, x.start), endMs: recToSongMs(out.song, clip, x.end) })));
      placed = pw.placed;
      return pw.song;
    }, 'Vocals to melody + lyrics');
    return { trackId: id, notes: count, raw: r.notes, centOffset: r.centOffset, words: w?.words ?? [], placed, inferMs: r.inferMs + (w?.inferMs ?? 0) };
  }

  /** Item 5: drum stem -> drum track. */
  async drums(trackId: string, opts: { grid: string; loose: boolean }) {
    const rc = this.clipOf(trackId);
    if (!rc) throw new Error('That track has no audio clip.');
    const wav = await this.wavFor(rc.clip.file);
    const r = await this.withJob('Drums to a drum track', () => window.mg.mlRun<{ hits: DrumHitIn[] }>('drums', { wav }));
    let id = '';
    let count = 0;
    this.store.edit((s) => {
      const out = addDrumTranscription(s, this.clipOf(trackId)!.clip, r.hits, { ...opts, sourceTrackId: trackId });
      id = out.id;
      count = out.notes;
      return out.song;
    }, 'Drums to a drum track');
    return { trackId: id, notes: count, hits: r.hits };
  }

  /**
   * Item 7: Rocksmith export settings for a song made from a recording: the ORIGINAL recording is
   * the song audio (bar 1 sits where it sits in the recording), transcribed bass -> Bass, the first
   * transcribed guitar -> Lead, a second -> Rhythm.
   */
  rocksmithSettings(song: Song | null = this.store.state.song): RocksmithExport | null {
    if (!song) return null;
    const rc = this.recordingClip(song);
    const parts = song.tracks.filter((t) => t.tuning && !t.audio && (t.analysis?.kind === 'transcription' || !song.recording));
    const arrangements: RocksmithExport['arrangements'] = [];
    let guitars = 0;
    for (const t of parts) {
      const bass = t.tuning!.length === 4 || t.instrument.program >= 32 && t.instrument.program <= 39;
      if (bass) { if (!arrangements.some((a) => a.type === 'Bass')) arrangements.push({ trackId: t.id, type: 'Bass' }); }
      else arrangements.push({ trackId: t.id, type: guitars++ === 0 ? 'Lead' : 'Rhythm' });
    }
    const prev = song.rocksmith;
    return {
      ...(prev ?? {}),
      title: prev?.title || song.title,
      artist: prev?.artist || song.artist,
      arrangements: arrangements.length ? arrangements : prev?.arrangements ?? [],
      audio: rc ? 'file' : prev?.audio ?? 'mix',
      audioFile: rc ? mediaPath(rc.clip.file) : prev?.audioFile,
      // Where bar 1 starts in the recording (ms): the clip's source offset minus its song time.
      audioOffsetMs: rc ? Math.round(rc.clip.startMs - clipStartMs(song, rc.clip)) : prev?.audioOffsetMs,
    };
  }

  /** Open the Rocksmith export dialog with the wizard's settings. */
  openRocksmith() {
    const s = this.rocksmithSettings();
    if (!s) return;
    this.store.saveRsSettings(s);
    this.store.openRsExport(true);
  }
}
