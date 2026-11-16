import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { INSTRUMENT_GROUPS, INSTRUMENTS, type DisplayMode, type Track } from '../../model';
import { ScorePlayer, type PlayerStatus } from './player';
import type { AppState, Store } from './store';

function useStore(store: Store): AppState {
  return useSyncExternalStore((f) => store.on(f), () => store.state);
}

export function App({ store, onPlayer }: { store: Store; onPlayer: (p: ScorePlayer) => void }) {
  const state = useStore(store);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<ScorePlayer | null>(null);
  const [status, setStatus] = useState<PlayerStatus | null>(null);

  useEffect(() => {
    const p = new ScorePlayer(hostRef.current!, scrollRef.current!);
    setPlayer(p);
    onPlayer(p);
    const off = p.on(setStatus);
    return () => {
      off();
      p.api.destroy();
    };
  }, []);

  useEffect(() => {
    if (player && state.song) player.show(state.song, state.loadId);
  }, [player, state.song, state.loadId]);

  useEffect(() => {
    if (!player) return;
    player.setSpeed(state.practice.speed);
    player.setMetronome(state.practice.metronome);
    player.setCountIn(state.practice.countIn);
    player.setLooping(state.practice.loop);
  }, [player, state.practice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
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
      {state.error && (
        <div className="banner error">
          <span>{state.error}</span>
          <button onClick={() => store.clearError()}>OK</button>
        </div>
      )}
      <header className="toolbar">
        <div className="brand">music<b>Genie</b></div>
        <div className="group">
          <button onClick={() => store.openDialog()} title="Open (Ctrl+O)">Open…</button>
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
      </header>
      <div className="main">
        <aside className="tracks">
          <div className="tracks-head">
            <div className="title" title={song?.title}>{song ? song.title : 'No song open'}</div>
            {song && <div className="sub">{song.bars.length} bars · {song.tracks.length} tracks · {song.tempos[0]?.bpm} bpm{state.dirty ? ' · unsaved' : ''}</div>}
          </div>
          {song?.tracks.map((t) => <TrackRow key={t.id} track={t} store={store} />)}
          {!song && (
            <div className="empty">
              Open a MusicXML, Guitar Pro (3-7), MIDI or .mgproj file to begin.
              <button className="primary" onClick={() => store.openDialog()}>Open a file…</button>
            </div>
          )}
        </aside>
        <section className="score" ref={scrollRef}>
          <div ref={hostRef} className="at-host" />
        </section>
      </div>
      <footer className="status">
        <span>{status?.ready ? 'Player ready' : song ? 'Loading sounds…' : ''}</span>
        {status && song && <span data-testid="bar-indicator">Bar {status.currentBar + 1} / {song.bars.length}</span>}
        {state.lastAutosave && <span>Autosaved {new Date(state.lastAutosave).toLocaleTimeString()}</span>}
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
      <div className="row3">
        <label title="Volume">Vol
          <input type="range" min={0} max={1} step={0.05} value={t.mixer.volume}
            onChange={(e) => store.setMixer(t.id, { volume: Number(e.target.value) })} />
        </label>
        <label title="Pan">Pan
          <input type="range" min={-1} max={1} step={0.1} value={t.mixer.pan}
            onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} />
        </label>
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
