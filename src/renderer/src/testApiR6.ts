// Round 6 additions to window.mgTest (only installed with --hidden).
import type { Analysis } from './analysis';
import type { Store } from './store';
import type { ScorePlayer } from './player';
import { renderMix, wavBytes } from './audio/render';
import { swingTick } from '../../render/swing';
import { reviewCtl, reviewTest, type ReviewState } from './Review';
import { omrCtl } from './omr';
import { Fft } from '../../ml/dsp';
import { decodeRecording } from './audio/render';
import { addAudioTrack, addClip, barStartTicks, gridFromSong, msAtTick, tempoPoints, trackEvents, posToMs, clipStartMs, beatsInRecording, type Song } from '../../model';

export function installTestApiR6(store: Store, analysis: Analysis, getPlayer: () => ScorePlayer | null) {
  const player = () => {
    const p = getPlayer();
    if (!p) throw new Error('no player');
    return p;
  };
  const song = () => store.state.song!;
  /** Every note of every track in song ms. */
  const truthNotes = (s: Song) => {
    const pts = tempoPoints(s);
    // Swing is applied at playback: the heard time of a note is at its swung tick.
    const sw = s.playback?.swing ?? 0;
    const at = (tick: number) => msAtTick(pts, swingTick(tick, sw)) / 1000;
    return s.tracks.filter((t) => !t.audio).map((t) => ({
      id: t.id, name: t.name, percussion: t.instrument.percussion, tuning: t.tuning ?? null,
      notes: trackEvents(s, t).map((e) => ({ t: at(e.start), end: at(e.start + e.dur), pitch: e.pitch, string: e.string ?? null, fret: e.fret ?? null })),
    }));
  };
  const api = {
    mlProbe: () => analysis.probe(),
    mlModels: () => analysis.refreshModels(),
    mlAutoAccept: (on: boolean) => { analysis.autoAccept = on; },
    mlState: () => analysis.state,
    mlCancel: () => analysis.cancel(),
    mlCleanTemp: () => analysis.cleanTemp(),
    /**
     * Render the current song: the mix and each (unmuted, note) track alone, as 44.1 kHz WAVs,
     * plus the truth (beats, downbeats, notes in seconds). Rendering is offline (never heard).
     */
    async renderFixture(dir: string, name: string) {
      const s = song();
      const p = player();
      const files: Record<string, string> = {};
      const mix = await renderMix(p, s);
      files.mix = `${dir}\\${name}-mix.wav`;
      await window.mg.writeBytes(files.mix, wavBytes(mix.samples, mix.sampleRate));
      const tracks = s.tracks.filter((t) => !t.audio && !t.mixer.mute);
      for (const t of tracks) {
        const r = await renderMix(p, s, s.tracks.filter((x) => x.id !== t.id).map((x) => x.id));
        const key = t.instrument.percussion ? 'drums' : t.name.toLowerCase().split(/\s+/)[0];
        files[key] = `${dir}\\${name}-${key}.wav`;
        await window.mg.writeBytes(files[key], wavBytes(r.samples, r.sampleRate));
      }
      const g = gridFromSong(s);
      const truth = {
        name, bars: s.bars.length, tempos: s.tempos, swing: s.playback?.swing ?? 0, ts: s.bars.map((b) => b.timeSignature.numerator),
        beats: g.beats.map((b) => b / 1000), downbeats: g.barStarts.map((i) => g.beats[i] / 1000),
        tracks: truthNotes(s), files,
      };
      await window.mg.writeBytes(`${dir}\\${name}-truth.json`, new TextEncoder().encode(JSON.stringify(truth)));
      return truth;
    },
    setTempoChange: (bar: number, bpm: number) => store.setTempoChange(bar, bpm),
    setTimeSig: (bar: number, num: number, den: number, count?: number) => store.setTimeSig(bar, num, den, count),
    newFromRecording: (path: string) => analysis.newFromRecording(path),
    detectBeats: (opts?: { numerator?: number }) => analysis.detectBeats(opts),
    separateStems: (trackId?: string) => analysis.separateStems(trackId),
    transcribe: (trackId: string, opts: { kind: string; grid: string; loose: boolean }) => analysis.transcribe(trackId, opts),
    drumsFromAudio: (trackId: string, opts: { grid: string; loose: boolean }) => analysis.drums(trackId, opts),
    /** Beats of the current song in recording seconds (through the recording clip). */
    songBeatsInRecording() {
      const rc = analysis.recordingClip();
      if (!rc) return null;
      return beatsInRecording(song(), rc.clip);
    },
    recordingInfo() {
      const rc = analysis.recordingClip();
      if (!rc) return null;
      return { trackId: rc.track.id, clip: rc.clip, clipSongMs: clipStartMs(song(), rc.clip) };
    },
    /** Notes of a track in RECORDING seconds (through the recording clip). */
    trackNotesInRecording(trackId: string) {
      const s = song();
      const rc = analysis.recordingClip();
      const t = s.tracks.find((x) => x.id === trackId);
      if (!t || !rc) return null;
      const pts = tempoPoints(s);
      const c0 = clipStartMs(s, rc.clip);
      return trackEvents(s, t).map((e) => ({ t: (msAtTick(pts, e.start) - c0 + rc.clip.startMs) / 1000, pitch: e.pitch, string: e.string ?? null, fret: e.fret ?? null, dur: e.dur }));
    },
    /** A Rocksmith-imported song: every note of a track in recording seconds (chart time + offset). */
    chartNotes(trackIndex: number) {
      const s = song();
      const t = s.tracks[trackIndex];
      const pts = tempoPoints(s);
      const off = s.backing?.offsetMs ?? 0;
      return { name: t.name, tuning: t.tuning ?? null, notes: trackEvents(s, t).map((e) => ({ t: (msAtTick(pts, e.start) + off) / 1000, pitch: e.pitch, string: e.string ?? null, fret: e.fret ?? null })) };
    },
    /** A Rocksmith-imported song: its chart's beat markers (ebeats) in recording seconds. */
    chartBeats() {
      const s = song();
      const g = gridFromSong(s);
      return g.beats.map((b) => (b + (s.backing?.offsetMs ?? 0)) / 1000);
    },
    /** An audio track holding `path` at exactly the recording clip's place (a part rendered alone). */
    importAligned(path: string, name: string) {
      const rc = analysis.recordingClip();
      if (!rc) throw new Error('no recording');
      let id = '';
      store.edit((s) => {
        const a = addAudioTrack(s, name);
        id = a.id;
        return addClip(a.song, a.id, { ...rc.clip, id: 'part-' + a.id, name, file: path });
      }, 'Import part');
      return id;
    },
    wizardSettings: () => analysis.rocksmithSettings(),
    omrAutoAccept: (on: boolean) => { omrCtl.autoAccept = on; },
    omrImport: async (path: string) => {
      const r = await omrCtl.importScore(store, path);
      return r ? { files: r.files, issues: r.issues, ms: r.ms, logTail: r.log.slice(-3000) } : null;
    },
    /**
     * Where audio B sits relative to audio A (ms; B time = A time + lag), by cross-correlating the
     * first `secs` seconds of both (mono, 11.025 kHz) with an FFT.
     */
    async alignAudio(a: string, b: string, secs = 20, maxLagMs = 8000) {
      const mono = async (p: string) => {
        const x = await decodeRecording(p); // interleaved stereo, 44.1 kHz
        const n = Math.floor(x.length / 2 / 4);
        const m = new Float64Array(n);
        for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) m[i] += x[2 * (4 * i + k)] + x[2 * (4 * i + k) + 1];
        return m;
      };
      const sr = 11025;
      const A = await mono(a), B = await mono(b);
      const len = Math.min(Math.floor(secs * sr), A.length, B.length);
      let N = 1;
      while (N < 2 * len + 2 * Math.floor((maxLagMs / 1000) * sr)) N <<= 1;
      const fft = new Fft(N);
      const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
      ar.set(A.subarray(0, len));
      br.set(B.subarray(0, Math.min(B.length, len + Math.floor((maxLagMs / 1000) * sr))));
      fft.transform(ar, ai);
      fft.transform(br, bi);
      // corr[k] = sum A[i] B[i+k]  ->  conj(FA) * FB
      for (let i = 0; i < N; i++) {
        const r = ar[i] * br[i] + ai[i] * bi[i];
        const im = ar[i] * bi[i] - ai[i] * br[i];
        ar[i] = r; ai[i] = im;
      }
      fft.transform(ar, ai, true);
      const maxLag = Math.floor((maxLagMs / 1000) * sr);
      let best = 0, bv = -Infinity;
      for (let k = -maxLag; k <= maxLag; k++) {
        const v = ar[(k + N) % N];
        if (v > bv) { bv = v; best = k; }
      }
      // Parabolic refinement.
      const y0 = ar[(best - 1 + N) % N], y1 = ar[(best + N) % N], y2 = ar[(best + 1 + N) % N];
      const den = y0 - 2 * y1 + y2;
      const frac = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
      return { lagMs: ((best + frac) / sr) * 1000 };
    },
    review: (patch: Partial<ReviewState>) => reviewCtl.set(patch),
    reviewState: () => reviewCtl.state,
    reviewPitch: (ms?: number) => reviewTest.measurePitch(ms),
    reviewProbe: () => reviewTest.probe(),
    barMs: (bar: number) => posToMs(song(), bar, 0),
    barTick: (bar: number) => barStartTicks(song())[bar],
    _r6: { store, getPlayer },
  };
  const w = window as unknown as { mgTest: Record<string, unknown> };
  Object.assign(w.mgTest, api);
}
