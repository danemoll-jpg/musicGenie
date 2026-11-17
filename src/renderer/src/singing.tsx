// Round 7 singing: render a melody track + its lyrics as a sung audio track (DiffSinger + the Qixuan
// voicebank in the analysis worker), re-render when notes/lyrics change, and the fallbacks: export
// .ustx (OpenUtau) / .svp (Synthesizer V) and import a vocal rendered elsewhere.
import { useEffect, useState } from 'react';
import {
  addAudioTrack, addClip, hasLyrics, singingInput, songLengthMs, verseCount, voiceHash,
  type AudioClip, type Song, type Track, type VoiceSettings, type VoiceTag,
} from '../../model';
import { exportSvp, exportUstx } from '../../export/vocal';
import { loadMedia } from './audio/clips';
import { engine } from './audio/engine';
import { analysisCtl, useAnalysis } from './Round6';
import type { AppState, Store } from './store';

export const ENGINE = 'diffsinger:qixuan';
export const DEFAULT_VOICE: VoiceSettings = { vibratoCents: 35, vibratoHz: 5.5, dynamics: 0.5, breath: 0.4, gender: 0, steps: 20 };
const BANK_DIR = 'Qixuan_v2.7.0_DiffSinger_OpenUtau';

/** The sung audio track made from this melody track (and verse), if any. */
export function voiceTrackOf(song: Song, sourceId: string, verse?: number): Track | undefined {
  return song.tracks.find((t) => t.voice?.sourceTrackId === sourceId && (verse === undefined || t.voice.verse === verse));
}

export function isOutOfDate(song: Song, vt: Track): boolean {
  const src = song.tracks.find((t) => t.id === vt.voice!.sourceTrackId);
  if (!src) return false;
  return voiceHash(song, src, vt.voice!.verse, vt.voice!.settings) !== vt.voice!.renderedHash;
}

export interface SingResult { file: string; phrases: number; frames: number; provider: string; seconds: number; durationS: number }

/** Sing `trackId`'s verse; the result replaces the clip of its sung track (or makes one). One undo step. */
export async function singTrack(store: Store, trackId: string, verse: number, settings: VoiceSettings, auto = false): Promise<SingResult | null> {
  const ctl = analysisCtl.current;
  const song0 = store.state.song;
  if (!ctl || !song0) return null;
  const src = song0.tracks.find((t) => t.id === trackId);
  if (!src) return null;
  const syllables = singingInput(song0, src, verse);
  if (!syllables.length) throw new Error(`"${src.name}" has no lyrics in verse ${verse + 1}: add them in the Lyrics tab first.`);
  if (!(await ctl.ensureModels(['qixuan', 'pc-nsf-hifigan']))) return null;
  const bank = await ctl.modelFile('qixuan', BANK_DIR);
  const vocoder = (await ctl.modelFile('pc-nsf-hifigan', 'x')).replace(/[\\/]x$/, '');
  const hash = voiceHash(song0, src, verse, settings);
  const out = `${await ctl.mediaDir()}\\sung-${trackId}-v${verse + 1}-${Date.now().toString(36)}.wav`;
  const totalMs = songLengthMs(song0);
  const r = await ctl.withJob('Singing ' + src.name, () => window.mg.mlRun<SingResult>('sing', { bank, vocoder, syllables, settings, totalMs, out }));
  const ms = r.durationS * 1000;
  store.edit((s) => {
    let song = s;
    let vt = voiceTrackOf(song, trackId, verse);
    let id = vt?.id;
    if (!id) {
      const a = addAudioTrack(song, `${src.name} (sung${verse ? ' v' + (verse + 1) : ''})`);
      song = a.song;
      id = a.id;
    }
    const clip: AudioClip = { id: 'sung', name: `${src.name} sung`, file: r.file, bar: 0, tick: 0, startMs: 0, lengthMs: ms, sourceMs: ms, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 };
    song = { ...song, tracks: song.tracks.map((t) => (t.id === id ? { ...t, audio: { ...t.audio!, clips: [] } } : t)) };
    song = addClip(song, id, clip);
    const tag: VoiceTag = { sourceTrackId: trackId, verse, engine: ENGINE, settings: { ...settings }, renderedHash: hash, auto: vt?.voice?.auto ?? auto };
    song = { ...song, tracks: song.tracks.map((t) => (t.id === id ? { ...t, voice: tag } : t)) };
    vt = song.tracks.find((t) => t.id === id);
    return song;
  }, 'Sing ' + src.name);
  return r;
}

/** Re-sing tracks marked "auto" a few seconds after their notes or lyrics change. */
export function startAutoSing(store: Store) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.on(() => {
    const song = store.state.song;
    if (!song) return;
    const stale = song.tracks.filter((t) => t.voice?.auto && isOutOfDate(song, t));
    if (!stale.length) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const s = store.state.song;
      if (!s || analysisCtl.current?.busy) return;
      const t = s.tracks.find((x) => x.voice?.auto && isOutOfDate(s, x));
      if (t) void singTrack(store, t.voice!.sourceTrackId, t.voice!.verse, t.voice!.settings).catch((e) => store.showError((e as Error).message));
    }, 3000);
  });
}

/** A vocal rendered elsewhere (OpenUtau, Synthesizer V...) back in at bar 1. */
export async function importRenderedVocal(store: Store, sourceTrackId: string | null, path?: string): Promise<boolean> {
  const p = path ?? (await window.mg.pickFile('Rendered vocal', [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac'] }]));
  if (!p || !store.state.song) return false;
  const buf = await loadMedia(engine.ctx, p);
  const ms = (buf.length / buf.sampleRate) * 1000;
  const name = p.split(/[\\/]/).pop() ?? 'vocal';
  const src = store.state.song.tracks.find((t) => t.id === sourceTrackId);
  store.edit((s) => {
    const a = addAudioTrack(s, src ? `${src.name} (vocal)` : 'Vocal');
    return addClip(a.song, a.id, { id: 'vocal', name, file: p, bar: 0, tick: 0, startMs: 0, lengthMs: ms, sourceMs: ms, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 });
  }, 'Import rendered vocal');
  return true;
}

function Slider({ label, value, min, max, step, onChange, fmt, title }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; title?: string }) {
  return (
    <label className="vslider" title={title}>{label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt(value)}</span>
    </label>
  );
}

export function VoicePanel({ state, store, track }: { state: AppState; store: Store; track: Track }) {
  const song = state.song!;
  const a = useAnalysis();
  const verses = Math.max(1, verseCount(track));
  const [verse, setVerse] = useState(0);
  const vt = voiceTrackOf(song, track.id, verse);
  const [set, setSet] = useState<VoiceSettings>(vt?.voice?.settings ?? DEFAULT_VOICE);
  const [last, setLast] = useState<SingResult | null>(null);
  useEffect(() => { if (vt?.voice) setSet(vt.voice.settings); }, [vt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const up = (p: Partial<VoiceSettings>) => setSet({ ...set, ...p });
  const stale = vt ? isOutOfDate(song, vt) || JSON.stringify(vt.voice!.settings) !== JSON.stringify(set) : true;
  const lyr = hasLyrics(track);
  const sing = () => singTrack(store, track.id, verse, set).then((r) => r && setLast(r)).catch((e) => store.showError((e as Error).message));
  const save = async (ext: 'ustx' | 'svp') => {
    const p = await window.mg.savePath(`${song.title || 'song'} - ${track.name}`, ext, ext === 'ustx' ? 'OpenUtau project' : 'Synthesizer V project');
    if (!p) return;
    const text = ext === 'ustx' ? exportUstx(song, track, verse) : exportSvp(song, track, verse);
    await window.mg.writeBytes(p, new TextEncoder().encode(text));
    store.showInfo('Saved ' + p + '. Render it in ' + (ext === 'ustx' ? 'OpenUtau' : 'Synthesizer V') + ' from bar 1, then use "Import rendered vocal…".');
  };
  return (
    <section className="voice-panel" data-testid="voice-panel">
      <h4>Singing <span className="sub">DiffSinger · Qixuan voicebank (credit "Qixuan (绮萱) / DiffSinger", mark songs as AI-made)</span></h4>
      <div className="vrow">
        {verses > 1 && <label>Verse <select value={verse} onChange={(e) => setVerse(Number(e.target.value))}>{Array.from({ length: verses }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>}
        <Slider label="Vibrato" value={set.vibratoCents} min={0} max={100} step={5} onChange={(v) => up({ vibratoCents: v })} fmt={(v) => v + ' c'} title="Vibrato depth on long notes (cents)" />
        <Slider label="Rate" value={set.vibratoHz} min={3.5} max={7.5} step={0.25} onChange={(v) => up({ vibratoHz: v })} fmt={(v) => v.toFixed(2) + ' Hz'} />
        <Slider label="Dynamics" value={set.dynamics} min={0} max={1} step={0.05} onChange={(v) => up({ dynamics: v })} fmt={(v) => Math.round(v * 100) + '%'} title="How much the note velocities change the loudness" />
        <Slider label="Breath" value={set.breath} min={0} max={1} step={0.05} onChange={(v) => up({ breath: v })} fmt={(v) => Math.round(v * 100) + '%'} title="Breaths before phrases and a breathier tone" />
        <Slider label="Voice" value={set.gender} min={-0.6} max={0.6} step={0.05} onChange={(v) => up({ gender: v })} fmt={(v) => (v > 0 ? '+' : '') + v.toFixed(2)} title="Voice character: lower = deeper, higher = brighter" />
        <label title="More steps = cleaner, slower">Quality <select value={set.steps} onChange={(e) => up({ steps: Number(e.target.value) })}>
          <option value={10}>draft</option><option value={20}>normal</option><option value={40}>best</option></select></label>
      </div>
      <div className="vrow">
        <button className="primary" disabled={!lyr || !!a.job} onClick={() => void sing()} data-testid="sing">{vt ? 'Sing again' : 'Sing'}</button>
        {vt && <span className={stale ? 'warn' : 'ok'} data-testid="sing-status">{stale ? 'out of date: notes, lyrics or settings changed' : 'up to date'}</span>}
        {vt && <label className="check" title="Sing again by itself a few seconds after notes or lyrics change">
          <input type="checkbox" checked={!!vt.voice?.auto} onChange={(e) => store.updateTrack(vt.id, (t) => ({ ...t, voice: { ...t.voice!, auto: e.target.checked } }), 'Auto re-sing')} /> re-sing after edits</label>}
        {!lyr && <span className="sub">Add lyrics above first.</span>}
        {last && <span className="sub" data-testid="sing-last">{last.durationS.toFixed(1)} s sung in {last.seconds} s ({last.provider === 'dml' ? 'GPU' : 'CPU'}, {last.phrases} phrases)</span>}
        <span className="spacer" />
        <button disabled={!lyr} onClick={() => void save('ustx')} title="OpenUtau project with this melody and lyrics">Export .ustx…</button>
        <button disabled={!lyr} onClick={() => void save('svp')} title="Synthesizer V project with this melody and lyrics">Export .svp…</button>
        <button onClick={() => void importRenderedVocal(store, track.id).catch((e) => store.showError((e as Error).message))} title="A WAV rendered from the exported file, placed at bar 1">Import rendered vocal…</button>
      </div>
    </section>
  );
}
