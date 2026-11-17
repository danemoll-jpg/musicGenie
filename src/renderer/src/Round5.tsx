// Round 5 UI: File > Export dialog.
import { useEffect, useState } from 'react';
import { defaultExportSettings, exportSong, type ExportReport, type ExportSettings } from './exportSong';
import type { ScorePlayer } from './player';
import type { AppState, Store } from './store';
import { HelpButton, MoreOptions } from './HelpUi';

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
        <h3><HelpButton topic="export" label="dialog" /> Export “{song.title}”</h3>
        <div className="export-grid">
          <span className="lbl">Folder</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={s.dir} onChange={(e) => set({ dir: e.target.value })} style={{ flex: 1 }} title="The folder the exported files go into" />
            <button onClick={async () => { const d = await window.mg.pickFolder('Export to'); if (d) set({ dir: d }); }} title="Choose a different folder for the exported files">…</button>
          </span>
          <span className="lbl">File name</span>
          <input value={s.name} onChange={(e) => set({ name: e.target.value })} title="Name for the exported files (each type gets its own ending, e.g. .mp3, .pdf)" />
          <span className="lbl" title="Mixdown: the whole song mixed into one audio file">Whole song (mixdown)</span>
          <span>{chk('wav', 'WAV (16-bit)', 'WAV: full-quality audio file, best for editing or burning to CD (large file)')} {chk('mp3', 'MP3', 'MP3: smaller audio file for phones, email and sharing')}</span>
          <span className="lbl" title="Stems: one audio file per instrument, for mixing elsewhere or practising along">Each instrument separately (stems)</span>
          <select value={s.stems} onChange={(e) => set({ stems: e.target.value as ExportSettings['stems'] })} title="Stems: also save each instrument as its own audio file, e.g. to mix in another program or to practise with one part missing">
            <option value="none">no</option>
            <option value="tracks">one WAV per track</option>
            <option value="buses">one WAV per shared effect (Reverb, Echo)</option>
            <option value="both">per track and per shared effect</option>
          </select>
          <span className="lbl" title="The notes themselves, to open in other music programs">Notes for other programs</span>
          <span>{chk('midi', 'MIDI', 'MIDI: the notes for almost any music program or keyboard')} {chk('musicxml', 'MusicXML', 'MusicXML: sheet music for notation programs like MuseScore or Sibelius')} {chk('gp', 'Guitar Pro (.gp)', 'Guitar Pro: tabs for Guitar Pro and similar tab programs')}</span>
          <span className="lbl">PDF / print</span>
          <span>{chk('pdf', 'Score PDF', 'Sheet music as a PDF you can print or share')}
            <select value={s.pdfMode} onChange={(e) => set({ pdfMode: e.target.value as ExportSettings['pdfMode'] })} title="What the PDF shows: normal sheet music (notation), guitar tab, or both">
              <option value="both">notation + tab</option><option value="notation">notation</option><option value="tab">tab</option>
            </select>
            <select value={s.pageSize} onChange={(e) => set({ pageSize: e.target.value as 'Letter' | 'A4' })} title="Paper size: Letter (USA/Canada) or A4 (most other countries)"><option>Letter</option><option>A4</option></select>
          </span>
          <span className="lbl">More</span>
          <MoreOptions title="Audio quality, loudness and ending: the defaults suit most songs">
            <label title="MP3 quality (bit rate): higher = better sound and a bigger file; 192 is fine for most uses">MP3 quality
              <select value={s.mp3Kbps} onChange={(e) => set({ mp3Kbps: Number(e.target.value) })}>{[128, 192, 256, 320].map((k) => <option key={k} value={k}>{k} kbps</option>)}</select>
            </label>
            <span>{chk('normalize', 'Even out loudness to', 'Normalise: make the song as loud as typical streamed music (integrated loudness in LUFS, EBU R128 / BS.1770); -14 suits most streaming sites')}
              <input type="number" value={s.targetLufs} step={0.5} style={{ width: 60 }} onChange={(e) => set({ targetLufs: Number(e.target.value) })} title="Target loudness in LUFS: -14 = streaming sites, -16 = podcasts, higher (e.g. -9) = louder" /> LUFS</span>
            <span>{chk('limit', 'Stop peaks above', 'Peak limit: the loudest moments never go above this level, so the file does not distort')}
              <input type="number" value={s.ceilingDb} step={0.1} max={0} style={{ width: 56 }} onChange={(e) => set({ ceilingDb: Number(e.target.value) })} title="Highest level allowed in dB (dBFS); -1 is a safe choice" /> dB</span>
            <label title="Extra silence after the last bar so reverb and echoes can ring out instead of being cut off">Ending
              <input type="number" min={0} step={500} value={s.tailMs} style={{ width: 70 }} onChange={(e) => set({ tailMs: Math.max(0, Number(e.target.value)) })} /> ms after the last bar</label>
          </MoreOptions>
          <span className="lbl">Parts to print</span>
          <span className="full-parts">
            {song.tracks.map((t, i) => (t.audio ? null : (
              <label key={t.id} className="check" title={`Include ${t.name} in the PDF`}><input type="checkbox" checked={s.pdfTracks.includes(i)}
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
            {report.files[0] && <button onClick={() => void window.mg.reveal(report.files[0].path)} title="Open the export folder in Windows Explorer">Show in folder</button>}
          </div>
        )}
        <div className="row3" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={() => store.openExport(false)} title="Close this window without exporting (your choices are not kept)">Close</button>
          <button className="primary" disabled={!!busy || !player} data-testid="export-go" title="Make all the ticked files in the folder above" onClick={async () => {
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
