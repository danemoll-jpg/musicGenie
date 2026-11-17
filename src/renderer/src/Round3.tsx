// Round 3 UI: edit bar + technique palette, cursor overlay, tuning/capo controls, the recording
// (backing track) row, and the Export to Rocksmith dialog.
import { useEffect, useState } from 'react';
import {
  deleteBars, deleteBeat, deleteNote, hasTechnique, insertBars, insertBeat, isFretted,
  makeRest, paste, pitchName, presetFor, rocksmithProblem, setDuration, toggleDot, toggleTie, toggleTriplet,
  tuningPresetsFor, type Cursor, type DurationBase, type RocksmithExport, type RsArrangementType, type Song, type Track,
  hasLyrics, verseCount,
} from '../../model';
import { applyTechnique, copySelection, tabMode, TECH_KEYS } from './editor';
import type { PlayerStatus, Rect, ScorePlayer } from './player';
import { exportRocksmith } from './rocksmithExport';
import type { AppState, Store } from './store';

const DURATIONS: { base: DurationBase; label: string; name: string }[] = [
  { base: 1, label: '𝅝', name: 'Whole' }, { base: 2, label: '𝅗𝅥', name: 'Half' }, { base: 4, label: '♩', name: 'Quarter' },
  { base: 8, label: '♪', name: 'Eighth' }, { base: 16, label: '16', name: 'Sixteenth' }, { base: 32, label: '32', name: '32nd' },
  { base: 64, label: '64', name: '64th' },
];

function beatAtCursor(song: Song, c: Cursor) {
  return song.tracks[c.track]?.staves[c.staff]?.measures[c.bar]?.voices[c.voice]?.beats[c.beat];
}

export function EditBar({ state, store, player }: { state: AppState; store: Store; player: ScorePlayer | null }) {
  const song = state.song;
  const c = state.cursor;
  if (!state.editMode || !song) return null;
  const b = c ? beatAtCursor(song, c) : undefined;
  const t = c ? song.tracks[c.track] : undefined;
  const tab = !!(c && tabMode(song, c));
  const note = b && c ? (tab ? b.notes.find((n) => n.string === c.string) : b.notes[0]) : undefined;
  const range = player?.status.range;
  const where = c && t
    ? `${t.name} · bar ${c.bar + 1} · beat ${c.beat + 1}` + (tab && t.tuning ? ` · string ${c.string} (${pitchName(t.tuning[c.string - 1]).replace(/-?\d+$/, '')})` : '')
    : 'Click a beat in the score';
  const dur = b?.duration;
  return (
    <div className="editbar" data-testid="editbar">
      <span className="where" data-testid="cursor-info">{where}</span>
      <div className="group" title="Note length (] shorter, [ longer)">
        {DURATIONS.map((d) => (
          <button key={d.base} className={dur?.base === d.base ? 'chip' : ''} disabled={!c} title={d.name}
            onClick={() => store.editAt((s, cc) => setDuration(s, cc, { base: d.base, dots: dur?.dots ?? 0, tuplet: dur?.tuplet }), d.name)}>{d.label}</button>
        ))}
        <button className={dur?.dots ? 'chip' : ''} disabled={!c} title="Dotted (.)" onClick={() => store.editAt(toggleDot, 'Dot')}>•</button>
        <button className={dur?.tuplet ? 'chip' : ''} disabled={!c} title="Triplet (Shift+T)" onClick={() => store.editAt(toggleTriplet, 'Triplet')}>3</button>
        <button className={note?.tieFromPrevious ? 'chip' : ''} disabled={!c} title="Tie to the previous beat (L)" onClick={() => store.editAt(toggleTie, 'Tie')}>⁀</button>
        <button disabled={!c} title="Make a rest (R)" onClick={() => store.editAt(makeRest, 'Rest')}>𝄽</button>
      </div>
      <div className="group palette" title="Techniques (apply to the note on the cursor string)">
        {TECH_KEYS.map((tk) => (
          <button key={tk.id} disabled={!b?.notes.length} title={tk.title} data-tech={tk.id}
            className={note && (tk.id === 'bendFull' ? !!note.techniques?.bend : hasTechnique(note, tk.id)) ? 'chip' : ''}
            onClick={() => applyTechnique(store, tk.id)}>{tk.label}</button>
        ))}
      </div>
      <div className="group">
        <button disabled={!c} title="Delete the note on this string (Delete)" onClick={() => store.editAt((s, cc) => deleteNote(s, cc, !tab), 'Delete note')}>✕ Note</button>
        <button disabled={!c} title="Insert a beat (Insert)" onClick={() => store.editAt(insertBeat, 'Insert beat')}>+ Beat</button>
        <button disabled={!c} title="Delete this beat (Shift+Delete)" onClick={() => store.editAt(deleteBeat, 'Delete beat')}>− Beat</button>
        <button disabled={!c} title="Insert a bar before this one (Ctrl+Insert)" onClick={() => store.editAt((s, cc) => insertBars(s, cc.bar, 1), 'Insert bar')}>+ Bar</button>
        <button disabled={!c || song.bars.length < 2} title="Delete this bar, or the selected bars (Ctrl+Delete)"
          onClick={() => { store.editAt((s, cc) => deleteBars(s, range?.startBar ?? cc.bar, range?.endBar ?? cc.bar), 'Delete bars'); player?.clearRange(); }}>− Bar</button>
        <button disabled={!c} title="Copy this beat, or the selected bars (Ctrl+C)" onClick={() => copySelection(store, player)}>Copy</button>
        <button disabled={!c || !state.hasClip} title="Paste (Ctrl+V)" onClick={() => { const clip = store.getClip(); if (clip) store.editAt((s, cc) => paste(s, cc, clip), 'Paste'); }}>Paste</button>
      </div>
      <span className="sub hint">{tab ? 'Type frets (two digits quickly = 10-24); ↑↓ strings; Shift+↑↓ pitch' : 'Letters A-G (Shift = add to chord); ↑↓ pitch'} · ←→ beats · Esc ends editing</span>
    </div>
  );
}

/** Highlights the cursor beat (and the note on the cursor string) over the score. */
export function CursorOverlay({ state, player, status }: { state: AppState; player: ScorePlayer | null; status: PlayerStatus | null }) {
  const [rects, setRects] = useState<{ beat: Rect; note: Rect | null } | null>(null);
  const c = state.cursor;
  useEffect(() => {
    if (!player || !c || !state.editMode) return setRects(null);
    setRects(player.beatRects(c));
  }, [player, c, state.editMode, status?.renderCount, state.song]);
  if (!rects) return null;
  const host = document.querySelector('.at-host') as HTMLElement | null;
  const ox = host?.offsetLeft ?? 0;
  const oy = host?.offsetTop ?? 0;
  return (
    <>
      <div className="edit-cursor" data-testid="edit-cursor" style={{ left: ox + rects.beat.x - 3, top: oy + rects.beat.y, width: rects.beat.w + 6, height: rects.beat.h }} />
      {rects.note && <div className="edit-note" style={{ left: ox + rects.note.x - 3, top: oy + rects.note.y - 2, width: rects.note.w + 6, height: rects.note.h + 4 }} />}
    </>
  );
}

/** Tuning preset + capo selects for a fretted track. */
export function TuningControls({ track: t, store }: { track: Track; store: Store }) {
  if (!t.tuning || t.instrument.percussion) return null;
  const presets = tuningPresetsFor(t);
  const cur = presetFor(t);
  const names = t.tuning.map((p) => pitchName(p).replace(/-?\d+$/, '')).join(' ');
  return (
    <div className="row4">
      <select value={cur?.id ?? 'custom'} title={'Tuning: ' + names} data-testid="tuning-select"
        onChange={(e) => {
          if (e.target.value === 'custom') return store.openTuningDialog(t.id);
          const p = presets.find((x) => x.id === e.target.value);
          if (p) store.setTuning(t.id, p.pitches, 'keepPitch');
        }}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="custom">{cur ? 'Custom…' : `Custom (${names})…`}</option>
      </select>
      <select value={t.capo ?? 0} title="Capo" onChange={(e) => store.setCapo(t.id, Number(e.target.value))}>
        {Array.from({ length: 13 }, (_, i) => <option key={i} value={i}>{i ? `Capo ${i}` : 'No capo'}</option>)}
      </select>
      <button title="Custom tuning; choose whether notes keep their pitch or their frets" onClick={() => store.openTuningDialog(t.id)}>…</button>
    </div>
  );
}

const PITCHES = Array.from({ length: 50 }, (_, i) => 20 + i); // G#0 .. A4

export function TuningDialog({ state, store }: { state: AppState; store: Store }) {
  const t = state.song?.tracks.find((x) => x.id === state.tuningTrack);
  const [pitches, setPitches] = useState<number[]>(t?.tuning ?? []);
  useEffect(() => setPitches(t?.tuning ?? []), [state.tuningTrack]);
  if (!t?.tuning) return null;
  const presets = tuningPresetsFor(t);
  const apply = (mode: 'keepPitch' | 'keepFrets') => {
    store.setTuning(t.id, pitches, mode);
    store.openTuningDialog(null);
  };
  return (
    <div className="modal-back" data-testid="tuning-dialog">
      <div className="modal">
        <h3 className="mtitle">Tuning: {t.name}</h3>
        <div className="rowx wrap">
          <span className="sub">Preset</span>
          <select value="" onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) setPitches(p.pitches); }}>
            <option value="">choose…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="strings">
          {[...pitches].map((p, i) => ({ p, i })).reverse().map(({ p, i }) => (
            <label key={i} className="rowx">
              <span className="sub">String {i + 1}{i === 0 ? ' (lowest)' : ''}</span>
              <select value={p} onChange={(e) => setPitches(pitches.map((x, j) => (j === i ? Number(e.target.value) : x)))}>
                {PITCHES.map((q) => <option key={q} value={q}>{pitchName(q)}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p className="sub">Keep the sound: notes keep their pitch and move to new frets. Keep the frets: the same fingering, sounding in the new tuning.</p>
        <div className="rowx right">
          <button onClick={() => store.openTuningDialog(null)}>Cancel</button>
          <button onClick={() => apply('keepFrets')}>Apply, keep frets</button>
          <button className="primary" onClick={() => apply('keepPitch')}>Apply, keep the sound</button>
        </div>
      </div>
    </div>
  );
}

/** The recording that plays along (e.g. a Rocksmith song's audio). */
export function BackingRow({ song, store }: { song: Song; store: Store }) {
  const b = song.backing;
  if (!b) return null;
  return (
    <div className="track backing" data-testid="backing-row">
      <div className="row1">
        <span className="name" title={b.path}>🎧 {b.name}</span>
        <button className={`ms ${b.mute ? 'on mute' : ''}`} title="Mute the recording" onClick={() => store.setBacking({ mute: !b.mute })}>M</button>
      </div>
      <div className="row3">
        <label title="Volume">Vol
          <input type="range" min={0} max={1} step={0.05} value={b.volume} onChange={(e) => store.setBacking({ volume: Number(e.target.value) })} />
        </label>
        <label title="Where bar 1 starts in the recording (ms)">Start
          <input type="number" className="num" step={10} value={Math.round(b.offsetMs)} onChange={(e) => store.setBacking({ offsetMs: Number(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}

const TYPES: RsArrangementType[] = ['Lead', 'Rhythm', 'Bass'];

function defaultSettings(song: Song): RocksmithExport {
  if (song.rocksmith) return structuredClone(song.rocksmith);
  const seen = new Set<RsArrangementType>();
  const arrangements = song.tracks
    .filter((t) => isFretted(t) && (t.tuning!.length === 6 || t.tuning!.length === 4) && !t.mixer.mute)
    .map((t) => {
      const role = t.generated?.role;
      const type: RsArrangementType = t.rocksmith?.arrangement
        ?? (t.tuning!.length === 4 ? 'Bass' : role === 'rhythm' ? 'Rhythm' : 'Lead');
      const bonus = seen.has(type);
      seen.add(type);
      return bonus ? { trackId: t.id, type, bonus } : { trackId: t.id, type };
    });
  const sung = song.tracks.find((t) => hasLyrics(t));
  return {
    title: song.title, artist: song.artist, album: song.album, year: new Date().getFullYear(),
    ...(sung ? { vocals: { trackId: sung.id } } : {}),
    arrangements, audio: song.backing ? 'file' : 'mix', audioFile: song.backing?.path, audioOffsetMs: song.backing?.offsetMs,
    previewStartMs: 0,
  };
}

export function RocksmithDialog({ state, store, player }: { state: AppState; store: Store; player: ScorePlayer | null }) {
  const song = state.song;
  const ex = state.rsExport;
  const [s, setS] = useState<RocksmithExport | null>(null);
  const [wwise, setWwise] = useState<{ found: boolean; path?: string; version?: string; error?: string } | null>(null);
  const [dlc, setDlc] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  useEffect(() => {
    if (!ex.open || !song) return;
    setS(defaultSettings(song));
    void window.mg.rs<typeof wwise>('findWwise').then(setWwise).catch((e) => setWwise({ found: false, error: String(e) }));
    void (async () => {
      const st = await window.mg.settingsGet();
      if (st.rocksmithDlc) return setDlc(st.rocksmithDlc);
      const r = await window.mg.rs<{ dlcFolder: string | null }>('findRocksmith').catch(() => null);
      setDlc(r?.dlcFolder ?? null);
    })();
  }, [ex.open]);
  if (!ex.open || !song || !s) return null;
  const up = (p: Partial<RocksmithExport>) => setS({ ...s, ...p });
  const chosen = new Map(s.arrangements.map((a) => [a.trackId, a]));
  const toggle = (t: Track, on: boolean) => up({
    arrangements: on
      ? [...s.arrangements, { trackId: t.id, type: (t.tuning?.length === 4 ? 'Bass' : 'Lead') as RsArrangementType }]
      : s.arrangements.filter((a) => a.trackId !== t.id),
  });
  const setArr = (id: string, p: Partial<RocksmithExport['arrangements'][0]>) =>
    up({ arrangements: s.arrangements.map((a) => (a.trackId === id ? { ...a, ...p } : a)) });
  const problems = s.arrangements.map((a) => {
    const t = song.tracks.find((x) => x.id === a.trackId);
    return t ? rocksmithProblem(t, a.type) : 'missing track';
  }).filter(Boolean) as string[];
  const run = async () => {
    const settings: RocksmithExport = { ...s, copyToDlc: copy && dlc ? dlc : undefined };
    store.saveRsSettings(settings);
    store.setRsExport({ running: true, step: 'Starting', result: null, error: null });
    const off = window.mg.onRsProgress((m) => store.setRsExport({ step: m }));
    try {
      const st = await window.mg.settingsGet();
      const result = await exportRocksmith(player!, store.state.song!, settings, {
        author: st.author ?? undefined, onStep: (m) => store.setRsExport({ step: m }), outDir: store.exportDirOverride ?? undefined,
      });
      store.setRsExport({ result });
    } catch (e) {
      store.setRsExport({ error: (e as Error).message });
    } finally {
      off();
      store.setRsExport({ running: false, step: null });
    }
  };
  const r = ex.result;
  return (
    <div className="modal-back" data-testid="rs-dialog">
      <div className="modal wide">
        <h3 className="mtitle">Export to Rocksmith 2014</h3>
        <div className="sub">Parts (6-string guitar or 4-string bass)</div>
        <table className="lineup">
          <tbody>
            {song.tracks.filter((t) => isFretted(t)).map((t) => {
              const a = chosen.get(t.id);
              return (
                <tr key={t.id}>
                  <td><label className="check"><input type="checkbox" checked={!!a} onChange={(e) => toggle(t, e.target.checked)} /> {t.name}</label></td>
                  <td>{a && <select value={a.type} onChange={(e) => setArr(t.id, { type: e.target.value as RsArrangementType })}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select>}</td>
                  <td>{a && <label className="check" title="A bonus arrangement"><input type="checkbox" checked={!!a.bonus} onChange={(e) => setArr(t.id, { bonus: e.target.checked })} /> Bonus</label>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {problems.map((p) => <div key={p} className="problem">{p}</div>)}
        <div className="grid2">
          <span className="sub">Vocals (lyrics)</span>
          <span className="rowx">
            <select value={s.vocals?.trackId ?? ''} data-testid="rs-vocals" onChange={(e) => up({ vocals: e.target.value ? { trackId: e.target.value, verse: 0 } : undefined })}>
              <option value="">none</option>
              {song.tracks.filter((t) => hasLyrics(t)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {s.vocals && (() => { const t = song.tracks.find((x) => x.id === s.vocals!.trackId); const n = t ? verseCount(t) : 0; return n > 1 ? (
              <select value={s.vocals.verse ?? 0} onChange={(e) => up({ vocals: { ...s.vocals!, verse: Number(e.target.value) } })}>
                {Array.from({ length: n }, (_, i) => <option key={i} value={i}>verse {i + 1}</option>)}
              </select>) : null; })()}
          </span>
          <span className="sub">Title</span><input value={s.title ?? ''} onChange={(e) => up({ title: e.target.value })} />
          <span className="sub">Artist</span><input value={s.artist ?? ''} onChange={(e) => up({ artist: e.target.value })} />
          <span className="sub">Album</span><input value={s.album ?? ''} onChange={(e) => up({ album: e.target.value })} />
          <span className="sub">Year</span><input type="number" value={s.year ?? ''} onChange={(e) => up({ year: Number(e.target.value) || undefined })} />
          <span className="sub">Album art</span>
          <span className="rowx"><span className="path">{s.albumArt || 'plain cover'}</span>
            <button onClick={async () => { const p = await window.mg.pickFile('Album art', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'dds', 'bmp'] }]); if (p) up({ albumArt: p }); }}>Choose…</button></span>
          <span className="sub">Preview starts at</span>
          <span className="rowx"><input type="number" className="num" min={0} step={1} value={Math.round((s.previewStartMs ?? 0) / 1000)} onChange={(e) => up({ previewStartMs: Number(e.target.value) * 1000 })} /> s</span>
          <span className="sub">Audio</span>
          <span className="rowx wrap">
            <label className="check"><input type="radio" checked={s.audio === 'mix'} onChange={() => up({ audio: 'mix' })} /> Full mix</label>
            <label className="check"><input type="radio" checked={s.audio === 'mixWithout'} onChange={() => up({ audio: 'mixWithout' })} /> Mix without the exported parts</label>
            <label className="check"><input type="radio" checked={s.audio === 'file'} onChange={() => up({ audio: 'file' })} /> Recording</label>
          </span>
          {s.audio === 'file' && <>
            <span className="sub">Recording</span>
            <span className="rowx"><span className="path">{s.audioFile || 'none'}</span>
              <button onClick={async () => { const p = await window.mg.pickFile('Song recording', [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac'] }]); if (p) up({ audioFile: p }); }}>Choose…</button></span>
            <span className="sub">Bar 1 starts at</span>
            <span className="rowx"><input type="number" className="num" step={10} value={Math.round(s.audioOffsetMs ?? 0)} onChange={(e) => up({ audioOffsetMs: Number(e.target.value) })} /> ms in the recording</span>
          </>}
          <span className="sub">Rocksmith</span>
          <span className="rowx wrap">
            <label className="check"><input type="checkbox" checked={copy} disabled={!dlc} onChange={(e) => setCopy(e.target.checked)} /> Copy into</label>
            <span className="path">{dlc ?? 'Rocksmith 2014 not found'}</span>
            <button onClick={async () => { const p = await window.mg.pickFolder('Rocksmith 2014 dlc folder'); if (p) { setDlc(p); await window.mg.settingsSet({ rocksmithDlc: p }); } }}>Change…</button>
          </span>
          <span className="sub">Wwise</span>
          <span className={wwise?.found ? '' : 'problem'}>{wwise === null ? 'checking…' : wwise.found ? `Wwise ${wwise.version} (${wwise.path})` : 'Not found: the export will stop before the audio conversion and keep a DLC Builder project.'}</span>
        </div>
        {ex.running && <div className="banner info">Working: {ex.step}…</div>}
        {ex.error && <div className="problem">{ex.error}</div>}
        {r && (
          <div className="result" data-testid="rs-result">
            <b>{r.stage === 'done' ? 'Done: ' + r.psarc : r.stage === 'wwise' ? 'Stopped at the audio conversion (Wwise).' : 'The arrangement checks found problems.'}</b>
            {r.error && <div className="sub">{r.error}</div>}
            <div className="sub">Checks: {r.issues.length ? `${r.issues.length} issue(s)` : 'no problems'} · difficulty levels: {r.arrangements.map((a) => (a.syllables !== undefined ? `${a.arrangement}: ${a.syllables} syllables` : `${a.arrangement} ${a.ddLevels}`)).join(', ')}</div>
            {r.issues.slice(0, 12).map((i, k) => <div key={k} className={i.severity === 'error' ? 'problem' : 'sub'}>{i.arrangement}: {i.type}{i.timeMs !== null ? ` at ${(i.timeMs / 1000).toFixed(2)} s` : ''}</div>)}
            {r.copiedTo && <div className="sub">Copied to {r.copiedTo}</div>}
            {r.stage !== 'done' && <div className="sub">Kept: arrangement XML, the WAV and a DLC Builder project you can finish by hand: {r.rs2dlc}</div>}
            <button onClick={() => window.mg.reveal(r.psarc ?? r.rs2dlc)}>Show files</button>
          </div>
        )}
        <div className="rowx right">
          <button onClick={() => store.openRsExport(false)}>Close</button>
          <button className="primary" data-testid="rs-export" disabled={ex.running || !s.arrangements.length || problems.length > 0 || !player} onClick={() => void run()}>Export</button>
        </div>
      </div>
    </div>
  );
}
