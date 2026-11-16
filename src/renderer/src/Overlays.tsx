// In-app dialogs (never native ones: a native dialog would show even for a hidden test window).
import { useEffect, useState } from 'react';
import { chordName, parseChord, QUALITIES, SHARP_NAMES, FLAT_NAMES, type Quality } from '../../model';
import type { AppState, Store } from './store';

export function ConfirmDialog({ state, store }: { state: AppState; store: Store }) {
  if (!state.confirm) return null;
  return (
    <div className="modal-back" data-testid="confirm">
      <div className="modal">
        <p>{state.confirm.message}</p>
        <div className="rowx right">
          <button onClick={() => store.answer(false)}>Cancel</button>
          <button className="primary" onClick={() => store.answer(true)}>{state.confirm.yes}</button>
        </div>
      </div>
    </div>
  );
}

const QUALITY_LIST = Object.keys(QUALITIES) as Quality[];

export function ChordPickerPopover({ state, store }: { state: AppState; store: Store }) {
  const p = state.chordPicker;
  const flats = (state.song?.bars[p?.bar ?? 0]?.key.fifths ?? 0) < 0;
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  const parsed = p?.name ? parseChord(p.name) : null;
  const [root, setRoot] = useState(parsed?.root ?? 0);
  const [quality, setQuality] = useState<Quality>(parsed?.quality ?? 'maj');
  const [bass, setBass] = useState<number>(parsed && parsed.bass !== parsed.root ? parsed.bass : -1);
  useEffect(() => {
    setRoot(parsed?.root ?? 0);
    setQuality(parsed?.quality ?? 'maj');
    setBass(parsed && parsed.bass !== parsed.root ? parsed.bass : -1);
  }, [p?.bar, p?.tick, p?.name]);
  if (!p) return null;
  const name = chordName({ root, quality, bass: bass < 0 ? root : bass }, flats);
  return (
    <div className="chord-picker" style={{ left: p.x, top: p.y }} data-testid="chord-picker">
      <div className="cp-title">Chord at bar {p.bar + 1}{p.name ? `: ${p.name}` : ''}</div>
      <div className="rowx">
        <select value={root} onChange={(e) => setRoot(Number(e.target.value))} title="Root">
          {names.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} title="Type">
          {QUALITY_LIST.map((q) => <option key={q} value={q}>{(QUALITIES[q].suffix || 'maj')} · {QUALITIES[q].label}</option>)}
        </select>
        <select value={bass} onChange={(e) => setBass(Number(e.target.value))} title="Bass note (slash chord)">
          <option value={-1}>no slash</option>
          {names.map((n, i) => <option key={n} value={i}>/{n}</option>)}
        </select>
      </div>
      <div className="rowx right">
        <button onClick={() => store.setChord(p.bar, p.tick, null)}>Remove</button>
        <button onClick={() => store.openChordPicker(null)}>Cancel</button>
        <button className="primary" data-testid="chord-apply" onClick={() => store.setChord(p.bar, p.tick, name)}>Set {name}</button>
      </div>
    </div>
  );
}

export function SettingsMenu({ state, store, soundFont }: { state: AppState; store: Store; soundFont: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button onClick={() => setOpen(!open)} title="Settings">⚙ Settings</button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-info">SoundFont: <b>{soundFont}</b>{state.soundFontPath ? '' : ' (built in)'}</div>
          <button onClick={() => { setOpen(false); void store.chooseSoundFont(); }}>Load SoundFont… (.sf2 / .sf3)</button>
          <button disabled={!state.soundFontPath} onClick={() => { setOpen(false); void store.useDefaultSoundFont(); }}>Use the built-in SoundFont</button>
        </div>
      )}
    </div>
  );
}
