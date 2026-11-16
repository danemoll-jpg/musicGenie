import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hashOf, INSTRUMENT_GROUPS, INSTRUMENTS, STYLES, type DisplayMode, type Track } from '../../model';
import { BackingPlayer } from './audio/backing';
import { BandPanel } from './BandPanel';
import { editorKey } from './editor';
import { ChordPickerPopover, ConfirmDialog, SettingsMenu } from './Overlays';
import { DEFAULT_SOUNDFONT, ScorePlayer, type PlayerStatus } from './player';
import { BackingRow, CursorOverlay, EditBar, RocksmithDialog, TuningControls, TuningDialog } from './Round3';
import type { AppState, Store } from './store';

function useStore(store: Store): AppState {
  return useSyncExternalStore((f) => store.on(f), () => store.state);
}

export function App({ store, onPlayer }: { store: Store; onPlayer: (p: ScorePlayer, b: BackingPlayer) => void }) {
  const state = useStore(store);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<ScorePlayer | null>(null);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [showBand, setShowBand] = useState(true);
  const [newMenu, setNewMenu] = useState(false);
  const loadedSoundFont = useRef<string | null>(null);
  const backingRef = useRef<BackingPlayer | null>(null);

  useEffect(() => {
    const p = new ScorePlayer(hostRef.current!, scrollRef.current!);
    const b = new BackingPlayer(p);
    backingRef.current = b;
    p.onBeatClick = (hit) => store.setCursor({ ...hit, string: hit.string ?? store.state.cursor?.string ?? 1 });
    setPlayer(p);
    onPlayer(p, b);
    const off = p.on(setStatus);
    return () => {
      off();
      p.api.destroy();
    };
  }, []);

  useEffect(() => {
    if (player && state.song) player.show(state.song, state.loadId);
    void backingRef.current?.setSong(state.song);
  }, [player, state.song, state.loadId]);

  useEffect(() => {
    if (player) player.editMode = state.editMode;
  }, [player, state.editMode]);

  // SoundFont: load the user's file when chosen, the built-in one when cleared.
  useEffect(() => {
    if (!player) return;
    const want = state.soundFontPath;
    if (want === loadedSoundFont.current) return;
    loadedSoundFont.current = want;
    if (want) {
      window.mg.readFile(want)
        .then((f) => player.setSoundFont(f.bytes, f.name))
        .catch((e) => store.showError('Could not load the SoundFont: ' + (e as Error).message));
    } else player.setSoundFont(null, DEFAULT_SOUNDFONT);
  }, [player, state.soundFontPath]);

  // Click a chord symbol in the score -> chord picker.
  useEffect(() => {
    const host = hostRef.current;
    const scroll = scrollRef.current;
    if (!host || !scroll || !player) return;
    const onClick = (e: MouseEvent) => {
      const song = store.state.song;
      const text = (e.target as Element)?.closest?.('text');
      const label = text?.textContent?.trim();
      if (!song || !label) return;
      const r = host.getBoundingClientRect();
      const bar = player.barAtPoint(e.clientX - r.left, e.clientY - r.top);
      const chord = song.chordSymbols.find((c) => c.bar === bar && c.name === label);
      if (!chord) return;
      const sr = scroll.getBoundingClientRect();
      store.openChordPicker({
        bar: chord.bar, tick: chord.tick, name: chord.name,
        x: e.clientX - sr.left + scroll.scrollLeft, y: e.clientY - sr.top + scroll.scrollTop + 14,
      });
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, [player]);

  useEffect(() => {
    if (!player) return;
    player.setSpeed(state.practice.speed);
    backingRef.current?.setSpeed(state.practice.speed);
    player.setMetronome(state.practice.metronome);
    player.setCountIn(state.practice.countIn);
    player.setLooping(state.practice.loop);
  }, [player, state.practice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!typing && e.key !== ' ' && editorKey(store, player, e)) { e.preventDefault(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); store.redo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void store.save(e.shiftKey); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); void store.openDialog(); }
      else if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT') { e.preventDefault(); player?.playPause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const song = state.song;
  const p = state.practice;
  return (
    <div className="app">
      {state.recovery && (
        <div className="banner recovery" data-testid="recovery-banner">
          <span>
            musicGenie didn't close properly last time. Restore the work autosaved
            {state.recovery.savedAt ? ` at ${new Date(state.recovery.savedAt).toLocaleTimeString()}` : ''}?
          </span>
          <button className="primary" onClick={() => store.restoreRecovery()}>Restore</button>
          <button onClick={() => store.dismissRecovery()}>Discard</button>
        </div>
      )}
      <ConfirmDialog state={state} store={store} />
      {state.info && (
        <div className="banner info">
          <span>{state.info}</span>
          <button onClick={() => store.clearInfo()}>OK</button>
        </div>
      )}
      {state.busy && <div className="banner info" data-testid="busy"><span>{state.busy}</span></div>}
      {state.error && (
        <div className="banner error">
          <span>{state.error}</span>
          <button onClick={() => store.clearError()}>OK</button>
        </div>
      )}
      <header className="toolbar">
        <div className="brand">music<b>Genie</b></div>
        <div className="group">
          <div className="menu-wrap">
            <button onClick={() => setNewMenu(!newMenu)} title="Start a new song">New ▾</button>
            {newMenu && (
              <div className="menu left" onMouseLeave={() => setNewMenu(false)}>
                <button onClick={() => { setNewMenu(false); store.newSong('guitar'); }}>Guitar song (6 strings, tab + notation)</button>
                <button onClick={() => { setNewMenu(false); store.newSong('bass'); }}>Bass song (4 strings, tab)</button>
              </div>
            )}
          </div>
          <button onClick={() => store.openDialog()} title="Open (Ctrl+O): MusicXML, Guitar Pro, MIDI, Rocksmith .psarc / .rs2dlc / .xml, .mgproj">Open…</button>
          <button onClick={() => store.save()} disabled={!song} title="Save (Ctrl+S)">Save</button>
          <button onClick={() => store.save(true)} disabled={!song}>Save As…</button>
        </div>
        <div className="group">
          <button onClick={() => store.undo()} disabled={!state.canUndo} title={`Undo ${state.undoLabel ?? ''} (Ctrl+Z)`}>↶ Undo</button>
          <button onClick={() => store.redo()} disabled={!state.canRedo} title={`Redo ${state.redoLabel ?? ''} (Ctrl+Y)`}>↷ Redo</button>
        </div>
        <div className="group transport">
          <button className="primary play" disabled={!song || !status?.ready} onClick={() => player?.playPause()} title="Play / pause (Space)">
            {status?.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button disabled={!song || !status?.ready} onClick={() => player?.stop()}>■ Stop</button>
          <label className={`toggle ${p.loop ? 'on' : ''}`} title="Loop the selected bars (drag over the score to select)">
            <input type="checkbox" checked={p.loop} onChange={(e) => store.setPractice({ loop: e.target.checked })} /> Loop
          </label>
          {status?.range && (
            <button className="chip" onClick={() => player?.clearRange()} title="Clear selection">
              bars {status.range.startBar + 1}–{status.range.endBar + 1} ✕
            </button>
          )}
          <label className={`toggle ${p.metronome ? 'on' : ''}`}>
            <input type="checkbox" checked={p.metronome} onChange={(e) => store.setPractice({ metronome: e.target.checked })} /> Metronome
          </label>
          <label className={`toggle ${p.countIn ? 'on' : ''}`}>
            <input type="checkbox" checked={p.countIn} onChange={(e) => store.setPractice({ countIn: e.target.checked })} /> Count-in
          </label>
        </div>
        <div className="group">
          <label className="speed" title="Practice speed (does not change the song)">
            Speed
            <input type="range" min={25} max={150} step={5} value={p.speed}
              onChange={(e) => store.setPractice({ speed: Number(e.target.value) })} />
            <span className="val">{p.speed}%</span>
          </label>
        </div>
        <div className="group">
          <span className="lbl">Transpose song</span>
          <button disabled={!song} onClick={() => store.transpose(-1)}>−</button>
          <span className="val" data-testid="transpose-total">{state.transposeTotal > 0 ? '+' : ''}{state.transposeTotal}</span>
          <button disabled={!song} onClick={() => store.transpose(1)}>+</button>
        </div>
        <div className="group">
          <button className={state.editMode ? 'chip' : ''} disabled={!song} data-testid="edit-toggle"
            title="Edit notes: click a beat, type frets (tab) or A-G (notation)" onClick={() => store.setEditMode(!state.editMode)}>✎ Edit</button>
          <button disabled={!song} data-testid="rs-open" title="Export guitar/bass parts as a Rocksmith 2014 song" onClick={() => store.openRsExport(true)}>⇪ Rocksmith…</button>
        </div>
        <div className="group right">
          <button className={showBand ? 'chip' : ''} disabled={!song} onClick={() => setShowBand(!showBand)} title="Chords, sections and the virtual band">🎸 Band</button>
          <SettingsMenu state={state} store={store} soundFont={status?.soundFont ?? DEFAULT_SOUNDFONT} />
        </div>
      </header>
      <EditBar state={state} store={store} player={player} />
      <TuningDialog state={state} store={store} />
      <RocksmithDialog state={state} store={store} player={player} />
      <div className="main">
        <aside className="tracks">
          <div className="tracks-head">
            <div className="title" title={song?.title}>{song ? song.title : 'No song open'}</div>
            {song && <div className="sub">{song.bars.length} bars · {song.tracks.length} tracks · {song.tempos[0]?.bpm} bpm{state.dirty ? ' · unsaved' : ''}</div>}
          </div>
          {song?.tracks.map((t) => <TrackRow key={t.id} track={t} store={store} />)}
          {song && <BackingRow song={song} store={store} />}
          {!song && (
            <div className="empty">
              Open a MusicXML, Guitar Pro (3-7), MIDI, Rocksmith (.psarc) or .mgproj file, or start a new guitar or bass song.
              <button className="primary" onClick={() => store.openDialog()}>Open a file…</button>
            </div>
          )}
        </aside>
        <section className="score" ref={scrollRef}>
          <div ref={hostRef} className="at-host" />
          <CursorOverlay state={state} player={player} status={status} />
          <ChordPickerPopover state={state} store={store} />
        </section>
        {showBand && song && <BandPanel state={state} store={store} status={status} />}
      </div>
      <footer className="status">
        <span>{status?.ready ? 'Player ready' : song ? 'Loading sounds…' : ''}</span>
        {status && song && <span data-testid="bar-indicator">Bar {status.currentBar + 1} / {song.bars.length}</span>}
        {state.lastAutosave && <span>Autosaved {new Date(state.lastAutosave).toLocaleTimeString()}</span>}
        {status && <span data-testid="soundfont">Sound: {status.soundFont}</span>}
        {!!status?.swing && <span>Swing {Math.round(status.swing * 100)}%</span>}
        {window.mg.flags.mute && <span className="muted">MUTED (--mute)</span>}
      </footer>
    </div>
  );
}

function TrackRow({ track: t, store }: { track: Track; store: Store }) {
  const fretted = !!t.tuning;
  return (
    <div className={`track ${t.display.visible ? '' : 'hidden'}`} data-track={t.id}>
      <div className="row1">
        <input type="checkbox" checked={t.display.visible} title="Show this track"
          onChange={(e) => store.setDisplay(t.id, { visible: e.target.checked })} />
        <span className="name" title={t.name}>{t.name}</span>
        {t.generated && (
          <span className={`tag ${hashOf(t.staves) !== t.generated.contentHash ? 'edited' : ''}`}
            title={hashOf(t.staves) !== t.generated.contentHash ? 'Generated, then edited by hand' : `Generated: ${STYLES[t.generated.style].name}, ${t.generated.complexity}, seed ${t.generated.seed}`}>
            {hashOf(t.staves) !== t.generated.contentHash ? 'edited' : STYLES[t.generated.style].name.split(' ')[0]}
          </span>
        )}
        {t.derived && <span className="tag" title="Made by Split into band parts">{t.derived.part}</span>}
        <button className={`ms ${t.mixer.mute ? 'on mute' : ''}`} title="Mute" onClick={() => store.setMixer(t.id, { mute: !t.mixer.mute })}>M</button>
        <button className={`ms ${t.mixer.solo ? 'on solo' : ''}`} title="Solo" onClick={() => store.setMixer(t.id, { solo: !t.mixer.solo })}>S</button>
      </div>
      <div className="row2">
        <select value={t.instrument.id} onChange={(e) => store.setInstrument(t.id, e.target.value)} title="Instrument">
          {INSTRUMENT_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {INSTRUMENTS.filter((i) => i.group === g).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={t.display.mode} disabled={!fretted} title="Show as"
          onChange={(e) => store.setDisplay(t.id, { mode: e.target.value as DisplayMode })}>
          <option value="notation">Notation</option>
          <option value="tab">Tab</option>
          <option value="both">Both</option>
        </select>
      </div>
      <TuningControls track={t} store={store} />
      <div className="row3">
        <label title="Volume">Vol
          <input type="range" min={0} max={1} step={0.05} value={t.mixer.volume}
            onChange={(e) => store.setMixer(t.id, { volume: Number(e.target.value) })} />
        </label>
        <label title="Pan">Pan
          <input type="range" min={-1} max={1} step={0.1} value={t.mixer.pan}
            onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} />
        </label>
        {!t.instrument.percussion && !t.generated && (
          <button className="split" title="Split into band parts: melody, harmony, bass (this track is kept, muted)"
            onClick={() => store.splitTrack(t.id)}>Split</button>
        )}
        {!t.instrument.percussion && (
          <span className="tr" title="Transpose this track">
            <button onClick={() => store.transpose(-1, t.id)}>−</button>
            <button onClick={() => store.transpose(1, t.id)}>+</button>
          </span>
        )}
      </div>
    </div>
  );
}
