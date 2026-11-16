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
import './styles.css';

const store = new Store();
let player: ScorePlayer | null = null;
let backing: BackingPlayer | null = null;
const midi = new MidiController(store, () => player);

createRoot(document.getElementById('root')!).render(<App store={store} midi={midi} onPlayer={(p, b) => { player = p; backing = b; }} />);

void store.checkRecovery();
void store.initSettings();
setInterval(() => void store.autosaveNow(), window.mg.flags.autosaveMs);
if (window.mg.flags.open) void store.openPath(window.mg.flags.open);
if (window.mg.flags.hidden) installTestApi(store, () => player, () => backing, midi);
