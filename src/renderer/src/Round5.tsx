// Round 5 UI: File > Export dialog.
import { useEffect, useState } from 'react';
import { defaultExportSettings, exportSong, type ExportReport, type ExportSettings } from './exportSong';
import type { ScorePlayer } from './player';
import type { AppState, Store } from './store';

export function ExportDialog({ state, store, player }: { state: AppState; store: Store; player: ScorePlayer | null }) {
  const song = state.song;
  const [s, setS] = useState<ExportSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!state.exportOpen || !song) return;
    void window.mg.paths().then((p) => setS(defaultExportSettings(song, p.documents + '\\musicGenie\\Exports')));
    setReport(null);
    setErr(null);
  }, [state.exportOpen]);
  if (!state.exportOpen || !song || !s) return null;
  const set = (p: Partial<ExportSettings>) => setS({ ...s, ...p });
  const chk = (key: keyof ExportSettings, label: string, title?: string) => (
    <label className="check" title={title}><input type="checkbox" checked={!!s[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<ExportSettings>)} data-testid={'exp-' + key} /> {label}</label>
  );
  return (
    <div className="modal-back">
      <div className="modal wide" data-testid="export-dialog" style={{ width: 660, maxWidth: 660 }}>
        <h3>Export “{song.title}”</h3>
        <div className="export-grid">
          <span className="lbl">Folder</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={s.dir} onChange={(e) => set({ dir: e.target.value })} style={{ flex: 1 }} />
            <button onClick={async () => { const d = await window.mg.pickFolder('Export to'); if (d) set({ dir: d }); }}>…</button>
          </span>
          <span className="lbl">File name</span>
          <input value={s.name} onChange={(e) => set({ name: e.target.value })} />
          <span className="lbl">Mixdown</span>
          <span>{chk('wav', 'WAV (16-bit)')} {chk('mp3', 'MP3')}
            <select value={s.mp3Kbps} onChange={(e) => set({ mp3Kbps: Number(e.target.value) })}>{[128, 192, 256, 320].map((k) => <option key={k} value={k}>{k} kbps</option>)}</select>
          </span>
          <span className="lbl">Loudness</span>
          <span>{chk('normalize', 'Normalise to', 'Integrated loudness (EBU R128 / BS.1770)')}
            <input type="number" value={s.targetLufs} step={0.5} style={{ width: 60 }} onChange={(e) => set({ targetLufs: Number(e.target.value) })} /> LUFS
            {' '}{chk('limit', 'Peak limit at')}
            <input type="number" value={s.ceilingDb} step={0.1} max={0} style={{ width: 56 }} onChange={(e) => set({ ceilingDb: Number(e.target.value) })} /> dB
          </span>
          <span className="lbl">Ending</span>
          <span><input type="number" min={0} step={500} value={s.tailMs} style={{ width: 70 }} onChange={(e) => set({ tailMs: Math.max(0, Number(e.target.value)) })} /> ms after the last bar (reverb tails)</span>
          <span className="lbl">Stems</span>
          <select value={s.stems} onChange={(e) => set({ stems: e.target.value as ExportSettings['stems'] })}>
            <option value="none">none</option>
            <option value="tracks">one WAV per track</option>
            <option value="buses">one WAV per bus (Reverb, Delay)</option>
            <option value="both">per track and per bus</option>
          </select>
          <span className="lbl">Notes</span>
          <span>{chk('midi', 'MIDI')} {chk('musicxml', 'MusicXML')} {chk('gp', 'Guitar Pro (.gp)')}</span>
          <span className="lbl">PDF / print</span>
          <span>{chk('pdf', 'Score PDF')}
            <select value={s.pdfMode} onChange={(e) => set({ pdfMode: e.target.value as ExportSettings['pdfMode'] })}>
              <option value="both">notation + tab</option><option value="notation">notation</option><option value="tab">tab</option>
            </select>
            <select value={s.pageSize} onChange={(e) => set({ pageSize: e.target.value as 'Letter' | 'A4' })}><option>Letter</option><option>A4</option></select>
          </span>
          <span className="lbl">Parts to print</span>
          <span className="full-parts">
            {song.tracks.map((t, i) => (t.audio ? null : (
              <label key={t.id} className="check"><input type="checkbox" checked={s.pdfTracks.includes(i)}
                onChange={(e) => set({ pdfTracks: e.target.checked ? [...s.pdfTracks, i].sort((a, b) => a - b) : s.pdfTracks.filter((x) => x !== i) })} /> {t.name}</label>
            )))}
          </span>
        </div>
        {busy && <p className="hint">{busy}</p>}
        {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
        {report && (
          <div className="hint" data-testid="export-report">
            <p>Done{report.speed ? ` (rendered ${report.speed}× faster than real time)` : ''}. {report.lufsAfter !== undefined ? `Loudness ${report.lufsAfter} LUFS, peak ${report.peakDb} dBFS.` : ''}</p>
            <ul>{report.files.map((f) => <li key={f.kind + f.path}>{f.kind}: {f.path.split('\\').pop()} ({Math.round(f.bytes / 1024)} KB)</li>)}</ul>
            {report.files[0] && <button onClick={() => void window.mg.reveal(report.files[0].path)}>Show in folder</button>}
          </div>
        )}
        <div className="row3" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={() => store.openExport(false)}>Close</button>
          <button className="primary" disabled={!!busy || !player} data-testid="export-go" onClick={async () => {
            setErr(null);
            setReport(null);
            try {
              setReport(await exportSong(player!, song, s, (m) => setBusy(m)));
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}>Export</button>
        </div>
      </div>
    </div>
  );
}
