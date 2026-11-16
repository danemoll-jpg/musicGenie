// Must stay the first import: routes all audio through the master bus (muted with --mute)
// before alphaTab or anything else can create an audio node.
import './audio/masterBus';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Store } from './store';
import { installTestApi } from './testApi';
import type { ScorePlayer } from './player';
import type { BackingPlayer } from './audio/backing';
import { MidiController } from './midi';
import { AudioTracks } from './audioTracksCtl';
import { audioCtl } from './AudioTracks';
import { KeyboardPiano } from './kbdPiano';
import { kbdCtl } from './Round4';
import { liveSynth } from './audio/liveSynth';
import { engine } from './audio/engine';
import { recorder } from './audio/recorder';
import { PrintView } from './PrintView';
import './styles.css';

if (new URLSearchParams(location.search).get('print') === '1') {
  // Hidden print window (PDF export): only the score pages.
  createRoot(document.getElementById('root')!).render(<PrintView />);
} else {
  const store = new Store();
  let player: ScorePlayer | null = null;
  let backing: BackingPlayer | null = null;
  const midi = new MidiController(store, () => player);
  const audio = new AudioTracks(store, () => player);
  audioCtl.current = audio;
  const kbd = new KeyboardPiano(store, midi);
  kbdCtl.current = kbd;
  // Live notes (MIDI keyboard, keyboard piano, previews) play through the selected track's strip.
  liveSynth.target = () => {
    const t = store.state.song?.tracks[store.state.selTrack];
    return (t && engine.graph.strip(t.id)?.input) ?? null;
  };

  engine.keepAwake = () => recorder.state.open || midi.state.held.length > 0 || kbd.state.held.length > 0;
  createRoot(document.getElementById('root')!).render(<App store={store} midi={midi} onPlayer={(p, b) => { player = p; backing = b; }} />);

  void store.checkRecovery();
  void store.initSettings();
  setInterval(() => void store.autosaveNow(), window.mg.flags.autosaveMs);
  if (window.mg.flags.open) void store.openPath(window.mg.flags.open);
  if (window.mg.flags.hidden) installTestApi(store, () => player, () => backing, midi, audio, kbd);
}
