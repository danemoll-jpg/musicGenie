// In-app dialogs (never native ones: a native dialog would show even for a hidden test window).
import { useEffect, useState } from 'react';
import { chordName, parseChord, QUALITIES, SHARP_NAMES, FLAT_NAMES, type Quality } from '../../model';
import type { AppState, Store } from './store';
import { HelpButton } from './HelpUi';

export function ConfirmDialog({ state, store }: { state: AppState; store: Store }) {
  if (!state.confirm) return null;
  return (
    <div className="modal-back" data-testid="confirm">
      <div className="modal">
        <p>{state.confirm.message}</p>
        <div className="rowx right">
          <button onClick={() => store.answer(false)} title="Close this question without doing anything">Cancel</button>
          <button className="primary" onClick={() => store.answer(true)} title="Go ahead with what the question above describes">{state.confirm.yes}</button>
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
      <div className="cp-title">Chord at bar {p.bar + 1}{p.name ? `: ${p.name}` : ''} <HelpButton topic="chord-picker" label="chord picker" /></div>
      <div className="rowx">
        <select value={root} onChange={(e) => setRoot(Number(e.target.value))} title="The chord's main note (its letter name, e.g. C or G): pick the note the chord is built on">
          {names.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} title="The chord's flavour: major sounds bright, minor sad, 7 bluesy; try a few and listen">
          {QUALITY_LIST.map((q) => <option key={q} value={q}>{(QUALITIES[q].suffix || 'maj')} · {QUALITIES[q].label}</option>)}
        </select>
        <select value={bass} onChange={(e) => setBass(Number(e.target.value))} title="A different lowest note for the bass (slash chord, e.g. C/E); leave on no slash if unsure">
          <option value={-1}>no slash</option>
          {names.map((n, i) => <option key={n} value={i}>/{n}</option>)}
        </select>
      </div>
      <div className="rowx right">
        <button onClick={() => store.setChord(p.bar, p.tick, null)} title="Delete the chord symbol at this spot, e.g. if it was put there by mistake">Remove</button>
        <button onClick={() => store.exploreChord(name)} title="See and hear all the ways to play this chord on guitar or piano (chord explorer)" data-testid="chord-explore">Explore…</button>
        <button onClick={() => store.openChordPicker(null)} title="Close without changing the chord">Cancel</button>
        <button className="primary" data-testid="chord-apply" title="Put this chord at this spot in the song; the band follows it when you generate" onClick={() => store.setChord(p.bar, p.tick, name)}>Set {name}</button>
      </div>
    </div>
  );
}

export function SettingsMenu({ state, store, soundFont }: { state: AppState; store: Store; soundFont: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button onClick={() => setOpen(!open)} title="Choose the sound set (SoundFont) the instruments play with, e.g. for nicer pianos or guitars">⚙ Settings</button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-info" title="The sound set (SoundFont) every instrument is played with">Sound set: <b>{soundFont}</b>{state.soundFontPath ? '' : ' (built in)'} <HelpButton topic="sound-set" label="sound set" /></div>
          <button onClick={() => { setOpen(false); void store.chooseSoundFont(); }} title="Use a sound set file you downloaded (.sf2 / .sf3 SoundFont) for all instruments, e.g. for more realistic sounds">Load a sound set… (.sf2 / .sf3)</button>
          <button disabled={!state.soundFontPath} onClick={() => { setOpen(false); void store.useDefaultSoundFont(); }}
            title="Go back to the sound set that comes with the app, e.g. if a loaded one sounds wrong">Use the built-in sound set</button>
        </div>
      )}
    </div>
  );
}
