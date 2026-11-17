// Round 7 additions to window.mgTest (only installed with --hidden).
import type { Analysis } from './analysis';
import type { Store } from './store';
import type { ScorePlayer } from './player';
import {
  hasLyrics, lyricEvents, parseDescription, sanitizePlan, setTrackSound, singingInput, trackBank, verseCount, verseSyllables, type SongPlan, type VoiceSettings,
} from '../../model';
import { exportGuitarPro, exportMidi, exportMusicXml } from '../../export';
import { exportSvp, exportUstx } from '../../export/vocal';
import { DEFAULT_VOICE, isOutOfDate, singTrack, voiceTrackOf } from './singing';
import { addToLibrary, getLibrary, libraryPresets, removeFromLibrary } from './soundLib';
import { writeSf2 } from '../../render/sf2';
import { renderMix, wavBytes } from './audio/render';
import { liveSynth } from './audio/liveSynth';

export function installTestApiR7(store: Store, analysis: Analysis, getPlayer: () => ScorePlayer | null) {
  const song = () => store.state.song!;
  const player = () => { const p = getPlayer(); if (!p) throw new Error('no player'); return p; };
  const api = {
    // ----- lyrics
    verse: (ti: number, v: number) => verseSyllables(song(), song().tracks[ti], v),
    verses: (ti: number) => verseCount(song().tracks[ti]),
    lyricEvents: (ti: number, v: number) => lyricEvents(song(), song().tracks[ti], v).map((e) => ({ text: e.text, hyphen: e.hyphen, notes: e.notes.length, ms: Math.round(e.ms) })),
    async exportTo(kind: 'musicxml' | 'gp' | 'mid' | 'ustx' | 'svp', path: string, ti = 0) {
      const s = song();
      const bytes = kind === 'musicxml' ? new TextEncoder().encode(exportMusicXml(s)) : kind === 'gp' ? exportGuitarPro(s) : kind === 'mid' ? exportMidi(s)
        : new TextEncoder().encode(kind === 'ustx' ? exportUstx(s, s.tracks[ti]) : exportSvp(s, s.tracks[ti]));
      await window.mg.writeBytes(path, bytes);
      return { path, bytes: bytes.length };
    },
    // ----- singing
    sing: (ti: number, verse = 0, settings: Partial<VoiceSettings> = {}) => singTrack(store, song().tracks[ti].id, verse, { ...DEFAULT_VOICE, ...settings }),
    singInput: (ti: number, verse = 0) => singingInput(song(), song().tracks[ti], verse),
    voiceTrack: (ti: number, verse?: number) => {
      const t = voiceTrackOf(song(), song().tracks[ti].id, verse);
      return t ? { id: t.id, name: t.name, voice: t.voice, clips: t.audio?.clips ?? [], outOfDate: isOutOfDate(song(), t) } : null;
    },
    /** Pitch (Hz) of a stretch of a WAV, measured in the worker (YIN-style estimator). */
    wavPitch: (wav: string, fromS: number, lenS: number) => window.mg.mlRun<{ hz: number }>('pitch', { wav, fromS, lenS }),
    // ----- vocals from a recording
    vocals: (trackId: string, opts: { grid: string; loose: boolean; lyrics: boolean }) => analysis.vocals(trackId, opts),
    // ----- accuracy benchmark
    rsRead: (psarc: string, outDir: string) => window.mg.rs('read', { psarc, outDir }),
    transcribeWith: (trackId: string, opts: Parameters<Analysis['transcribe']>[1]) => analysis.transcribe(trackId, opts),
    wavFor: (file: string) => analysis.wavFor(file),
    // ----- describe
    describeParse: (text: string) => parseDescription(text),
    describeCreate: (plan: SongPlan) => store.createFromPlan(sanitizePlan(plan)),
    // ----- sound library
    library: () => getLibrary(),
    libraryAdd: (path: string) => addToLibrary(path),
    libraryRemove: (path: string) => removeFromLibrary(path),
    libraryPresets: (path: string) => getLibrary().then((l) => libraryPresets(l.find((x) => x.file === path) ?? { file: path, name: 'x', kind: /sfz$/i.test(path) ? 'sfz' : 'sf2' })),
    setTrackSound: (ti: number, sound: Parameters<typeof setTrackSound>[2], label = 'Sound') => store.edit((s) => setTrackSound(s, s.tracks[ti].id, sound), label),
    trackBank: (ti: number) => trackBank(song(), song().tracks[ti]),
    /** A one-preset test SoundFont: a pure sine (pitch = the key played), written to `path`. */
    async writeSineSf2(path: string) {
      const d = new Int16Array(44100);
      for (let i = 0; i < d.length; i++) d[i] = Math.round(14000 * Math.sin((2 * Math.PI * 440 * i) / 44100));
      // 1 s of 440 Hz is exactly 440 periods, so the whole sample loops without a click.
      const b = writeSf2('Test Sine', [{ name: 'sine440', data: d, rate: 44100, rootKey: 69, correction: 0, loopStart: 0, loopEnd: 44100 }],
        [{ sample: 0, loKey: 0, hiKey: 127, loVel: 1, hiVel: 127, loop: 1, attack: 0.005, release: 0.05 }]);
      await window.mg.writeBytes(path, b);
      return b.length;
    },
    /** Offline render of the song with every track muted except `ti` (the mixer's own render path). */
    async renderTrack(ti: number, path: string) {
      const s = song();
      const r = await renderMix(player(), s, s.tracks.filter((_, i) => i !== ti).map((t) => t.id));
      await window.mg.writeBytes(path, wavBytes(r.samples, r.sampleRate));
      return { path, sampleRate: r.sampleRate, frames: r.samples.length / 2 };
    },
    liveSynthName: () => liveSynth.name,
    hasLyrics: (ti: number) => hasLyrics(song().tracks[ti]),
    soundFontStatus: () => player().status.soundFont,
    soundFontLoads: () => player().status.soundFontLoads,
  };
  const w = window as unknown as { mgTest: Record<string, unknown> };
  Object.assign(w.mgTest, api);
}
