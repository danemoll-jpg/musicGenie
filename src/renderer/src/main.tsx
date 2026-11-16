// Must stay the first import: routes all audio through the master bus (muted with --mute)
// before alphaTab or anything else can create an audio node.
import './audio/masterBus';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Store } from './store';
import { installTestApi } from './testApi';
import type { ScorePlayer } from './player';
import './styles.css';

const store = new Store();
let player: ScorePlayer | null = null;

createRoot(document.getElementById('root')!).render(<App store={store} onPlayer={(p) => (player = p)} />);

void store.checkRecovery();
void store.initSettings();
setInterval(() => void store.autosaveNow(), window.mg.flags.autosaveMs);
if (window.mg.flags.open) void store.openPath(window.mg.flags.open);
if (window.mg.flags.hidden) installTestApi(store, () => player);
