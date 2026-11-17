// Round 6 UI: background job bar (progress + Cancel) and the 🎧 Recording dock tab: the
// "Song to Rocksmith" wizard, the single tools (beats, stems, audio to notes, drums), the review
// view switch, sheet music from PDF/photo, and the analysis engine + models.
import { useState, useSyncExternalStore } from 'react';
import type { Analysis, AnalysisState } from './analysis';
import type { AppState, Store } from './store';
import type { PlayerStatus, ScorePlayer } from './player';
import { GRIDS, PART_KINDS } from '../../model';
import { reviewCtl, useReview } from './Review';
import { omrCtl } from './omr';

export const analysisCtl: { current: Analysis | null } = { current: null };
export const playerCtl: { current: ScorePlayer | null } = { current: null };

const EMPTY: AnalysisState = { job: null, models: [], runtime: null, lastError: null, wizard: {} };
export function useAnalysis(): AnalysisState {
  return useSyncExternalStore((f) => analysisCtl.current?.on(f) ?? (() => {}), () => analysisCtl.current?.state ?? EMPTY);
}

const mb = (b: number) => (b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : (b / 1e3).toFixed(0) + ' kB');

/** A slim bar under the toolbar while a background job runs. The app stays usable. */
export function JobBar() {
  const a = useAnalysis();
  const j = a.job;
  if (!j) return null;
  const pct = j.total > 0 ? Math.min(100, (100 * j.done) / j.total) : 0;
  const isDl = j.stage.startsWith('download');
  return (
    <div className="jobbar" data-testid="jobbar">
      <span className="jt">{j.title}</span>
      <span className="js">{j.stage}{isDl ? ` · ${mb(j.done)} / ${mb(j.total)}` : j.total > 1 ? ` · ${j.done}/${j.total}` : ''}</span>
      <span className="jp"><span style={{ width: pct + '%' }} /></span>
      <button onClick={() => analysisCtl.current?.cancel()} data-testid="job-cancel">Cancel</button>
    </div>
  );
}

type StepState = 'todo' | 'done' | 'skipped';
function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children: React.ReactNode }) {
  return (
    <li className={`step ${state}`}>
      <span className="num">{state === 'done' ? '✓' : state === 'skipped' ? '–' : n}</span>
      <span className="st">{title}</span>
      <span className="sa">{children}</span>
    </li>
  );
}

/** Dock tab: recording to tabs (beats, stems, notes, drums, review, wizard, sheet music). */
export function RecordingPanel({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const a = useAnalysis();
  const r = useReview();
  const ctl = analysisCtl.current;
  const song = state.song;
  const busy = !!a.job;
  const [num, setNum] = useState(0);
  const [kinds, setKinds] = useState<{ bass: boolean; guitar: boolean; vocals?: boolean }>({ bass: true, guitar: true, vocals: false });
  const [grid, setGrid] = useState('1/16');
  const [loose, setLoose] = useState(false);
  const [txTrack, setTxTrack] = useState('');
  const [txKind, setTxKind] = useState('bass');
  const [drTrack, setDrTrack] = useState('');
  void status;
  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e) => { if ((e as Error).message !== 'Cancelled') store.showError((e as Error).message); });
  const rc = ctl?.recordingClip(song) ?? null;
  const stems = song?.tracks.filter((t) => t.analysis?.kind === 'stem') ?? [];
  const audioTracks = song?.tracks.filter((t) => t.audio?.clips.length) ?? [];
  const txs = song?.tracks.filter((t) => t.analysis?.kind === 'transcription') ?? [];
  const stemOf = (name: string) => stems.find((t) => t.analysis?.stem === name);
  const w = a.wizard;
  const st = (k: keyof typeof w, done: boolean): StepState => (done ? 'done' : w[k] === 'skipped' ? 'skipped' : 'todo');

  const transcribeParts = async () => {
    if (!ctl) return;
    if (kinds.bass) await ctl.transcribe((stemOf('bass') ?? rc!.track).id, { kind: 'bass', grid, loose });
    if (kinds.guitar) await ctl.transcribe((stemOf('guitar') ?? rc!.track).id, { kind: 'guitar', grid, loose });
    if (kinds.vocals) await ctl.vocals((stemOf('vocals') ?? rc!.track).id, { grid, loose, lyrics: true });
    ctl.setWizard({ notes: 'done' });
  };

  return (
    <div className="recpanel" data-testid="rec-panel">
      <section className="wizard">
        <h4>Song to Rocksmith</h4>
        <ol>
          <Step n={1} title={rc ? `Recording: ${rc.clip.name}` : 'Load a recording'} state={rc ? 'done' : 'todo'}>
            <button disabled={busy} onClick={run(() => ctl!.newFromRecording())} data-testid="wiz-load">{rc ? 'Load another…' : 'Load…'}</button>
          </Step>
          <Step n={2} title={w.beats === 'done' ? `Beats: ${song?.tempos[0]?.bpm.toFixed(1)} bpm, ${song?.bars[1]?.timeSignature.numerator ?? '?'}/4, ${song?.bars.length} bars` : 'Find beats and bars'} state={st('beats', w.beats === 'done')}>
            <select value={num} onChange={(e) => setNum(Number(e.target.value))} title="Beats per bar">
              <option value={0}>auto</option>
              {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
            </select>
            <button disabled={!rc || busy} onClick={run(async () => {
              if (w.beats === 'done' && ctl!.lastBeats && num) ctl!.redoBeats(num);
              else await ctl!.detectBeats({ numerator: num || undefined });
              ctl!.setWizard({ beats: 'done' });
            })} data-testid="wiz-beats">{w.beats === 'done' ? 'Redo' : 'Run'}</button>
            <button disabled={!rc || busy} onClick={() => ctl!.setWizard({ beats: 'skipped' })}>Skip</button>
          </Step>
          <Step n={3} title={stems.length ? `Stems: ${stems.map((t) => t.analysis!.stem).join(', ')}` : 'Split into stems (drums, bass, guitar, piano, vocals, other)'} state={st('stems', stems.length > 0)}>
            <button disabled={!rc || busy} onClick={run(() => ctl!.separateStems())} data-testid="wiz-stems">{stems.length ? 'Redo' : 'Run'}</button>
            <button disabled={!rc || busy} onClick={() => ctl!.setWizard({ stems: 'skipped' })}>Skip</button>
          </Step>
          <Step n={4} title={txs.length ? `Notes: ${txs.map((t) => t.name).join(', ')}` : 'Transcribe bass and/or guitar'} state={st('notes', txs.length > 0)}>
            <label><input type="checkbox" checked={kinds.bass} onChange={(e) => setKinds({ ...kinds, bass: e.target.checked })} /> bass</label>
            <label><input type="checkbox" checked={kinds.guitar} onChange={(e) => setKinds({ ...kinds, guitar: e.target.checked })} /> guitar</label>
            <label title="Vocal melody + lyrics (FCPE + Whisper)"><input type="checkbox" checked={!!kinds.vocals} onChange={(e) => setKinds({ ...kinds, vocals: e.target.checked })} data-testid="wiz-vocals" /> vocals</label>
            <select value={grid} onChange={(e) => setGrid(e.target.value)} title="Snap notes to">
              {GRIDS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <label title="Keep the timing as played (1/64 grid)"><input type="checkbox" checked={loose} onChange={(e) => setLoose(e.target.checked)} /> loose</label>
            <button disabled={!rc || busy || (!kinds.bass && !kinds.guitar && !kinds.vocals)} onClick={run(transcribeParts)} data-testid="wiz-notes">Run</button>
          </Step>
          <Step n={5} title="Review against the audio (fix notes and beats)" state={w.review === 'done' ? 'done' : 'todo'}>
            <button disabled={!song} className={r.on ? 'chip' : ''} onClick={() => {
              const stem = stemOf('bass') ?? stemOf('guitar');
              reviewCtl.set({ on: !r.on, source: stem && txs.length ? 'stemtx' : 'original', stemId: stem?.id ?? null, txId: txs[0]?.id ?? null });
              ctl!.setWizard({ review: 'done' });
            }} data-testid="wiz-review">{r.on ? 'Close review' : 'Open review'}</button>
          </Step>
          <Step n={6} title="Export to Rocksmith with the original recording as the song audio" state="todo">
            <button disabled={!song} data-testid="wiz-export"
              title={txs.some((t) => t.tuning) ? 'Opens the Rocksmith export with your recording as the song audio' : 'Needs a bass or guitar track from step 4 first'}
              onClick={() => {
                if (!txs.some((t) => t.tuning)) {
                  store.showError('Nothing to export yet: run step 4 (Transcribe bass and/or guitar) first. Rocksmith charts come from the bass/guitar tracks it makes.');
                  return;
                }
                ctl!.openRocksmith();
              }}>Export…</button>
          </Step>
        </ol>
      </section>

      <section>
        <h4>Tools</h4>
        <div className="row">
          <button disabled={busy} onClick={run(() => ctl!.newFromRecording())}>New song from a recording…</button>
          <button disabled={!song || busy} onClick={run(async () => { await ctl!.detectBeats(); ctl!.setWizard({ beats: 'done' }); })}>Find beats</button>
          <button disabled={!song} className={r.on ? 'chip' : ''} onClick={() => reviewCtl.set({ on: !r.on })} data-testid="review-toggle">Review view</button>
        </div>
        <div className="row">
          <span>Audio to notes:</span>
          <select value={txTrack} onChange={(e) => setTxTrack(e.target.value)}>
            <option value="">(audio track)</option>
            {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={txKind} onChange={(e) => setTxKind(e.target.value)}>
            {PART_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <button disabled={!txTrack || busy} onClick={run(() => ctl!.transcribe(txTrack, { kind: txKind, grid, loose }))}>Transcribe</button>
        </div>
        <div className="row">
          <span>Split stems of:</span>
          <select value={drTrack} onChange={(e) => setDrTrack(e.target.value)}>
            <option value="">(audio track)</option>
            {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button disabled={!drTrack || busy} onClick={run(() => ctl!.separateStems(drTrack))}>Stems</button>
          <button disabled={!drTrack || busy} onClick={run(() => ctl!.drums(drTrack, { grid, loose }))} title="Kick, snare, hi-hat, toms, crash, ride">Drums → drum track</button>
          <button disabled={!drTrack || busy} data-testid="vocals-run" onClick={run(() => ctl!.vocals(drTrack, { grid, loose, lyrics: true }))}
            title="Vocal stem → melody track (FCPE pitch tracker) with the lyrics on its notes (Whisper speech to text)">Vocals → melody + lyrics</button>
        </div>
        <div className="small">Results are ordinary tracks: edit them, undo them; the recording itself is never changed.</div>
      </section>

      <section>
        <h4>Sheet music from PDF or photo</h4>
        <div className="small">Reads printed notation with Audiveris (installed once into the app's data folder) and opens it as a song; bars it was unsure about are listed.</div>
        <div className="row">
          <button disabled={busy} onClick={run(() => omrCtl.importScore(store))} data-testid="omr-open">Read sheet music…</button>
        </div>
        {!!song?.tracks[0]?.omr?.issues.length && (
          <div className="row small" data-testid="omr-issues">
            Unsure:
            {song.tracks[0].omr.issues.slice(0, 40).map((i, k) => (
              <button key={k} title={i.text} onClick={() => { if (i.bar !== undefined) playerCtl.current?.seekBar(i.bar); }}>
                {i.bar !== undefined ? 'bar ' + (i.bar + 1) : 'page ' + i.page}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>Analysis engine</h4>
        <div className="small">
          ONNX Runtime from the app (no Python). GPU through DirectML when it works, otherwise the CPU. Jobs run in the background at
          Below Normal priority; models download once on first use.
        </div>
        {a.runtime && (
          <div className="small" data-testid="runtime">
            ONNX Runtime {a.runtime.ortVersion} · {a.runtime.provider}{a.runtime.gpu ? ` · ${a.runtime.gpu}` : ''} · test model {a.runtime.runMs} ms
            {a.runtime.cpuRunMs !== null ? ` (CPU ${a.runtime.cpuRunMs} ms)` : ''}
          </div>
        )}
        <button disabled={busy} onClick={run(() => ctl!.probe())}>Check engine</button>
        <table className="models">
          <tbody>
            {a.models.map((m) => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td className="small">{m.use}</td>
                <td>{mb(m.bytes)}</td>
                <td className="small" title={m.source}>{m.licence}</td>
                <td>{m.installed ? '✓ downloaded' : 'downloads on first use'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {a.lastError && <div className="small err">{a.lastError}</div>}
      </section>
    </div>
  );
}
