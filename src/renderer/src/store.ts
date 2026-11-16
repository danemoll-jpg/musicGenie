// App state: the song (through undo history), file path, and practice settings.
// All edits go through `edit()` so they are undoable and mark the project dirty.
import { importFile } from '../../import';
import {
  History, parseProject, serializeProject, setDisplay, setInstrument, setMixer, transpose,
  type DisplayMode, type Mixer, type Song,
} from '../../model';

export interface Practice {
  speed: number; // percent 25..150
  metronome: boolean;
  countIn: boolean;
  loop: boolean;
}

export interface AppState {
  song: Song | null;
  filePath: string | null;
  fileName: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  practice: Practice;
  error: string | null;
  recovery: { savedAt: string; json: string } | null;
  lastAutosave: string | null;
  transposeTotal: number;
  /** Increments on every file load/restore so views re-render even for an identical song. */
  loadId: number;
}

type Listener = (s: AppState) => void;

export class Store {
  private history: History<Song> | null = null;
  private listeners = new Set<Listener>();
  private autosaveDirty = false;
  state: AppState = {
    song: null, filePath: null, fileName: null, dirty: false, canUndo: false, canRedo: false,
    practice: { speed: 100, metronome: false, countIn: false, loop: false },
    error: null, recovery: null, lastAutosave: null, transposeTotal: 0, loadId: 0,
  };

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<AppState>) {
    const h = this.history;
    this.state = {
      ...this.state,
      ...p,
      canUndo: !!h?.canUndo,
      canRedo: !!h?.canRedo,
      undoLabel: h?.undoLabel,
      redoLabel: h?.redoLabel,
    };
    this.listeners.forEach((f) => f(this.state));
  }

  load(song: Song, filePath: string | null, fileName: string | null) {
    this.history = new History(song);
    this.autosaveDirty = true;
    this.set({ song, filePath, fileName, dirty: false, error: null, transposeTotal: 0, loadId: this.state.loadId + 1 });
  }

  openBytes(name: string, path: string | null, bytes: Uint8Array) {
    try {
      const song = importFile(name, bytes);
      const isProject = name.toLowerCase().endsWith('.mgproj');
      this.load(song, isProject ? path : null, name);
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  async openPath(path: string) {
    const f = await window.mg.readFile(path);
    this.openBytes(f.name, f.path, f.bytes);
  }

  async openDialog() {
    const p = await window.mg.openDialog();
    if (p) await this.openPath(p);
  }

  async save(as = false) {
    const song = this.state.song;
    if (!song) return;
    const path = await window.mg.saveProject(serializeProject(song), as ? null : this.state.filePath, song.title);
    if (path) this.set({ filePath: path, fileName: path.split(/[\\/]/).pop() ?? path, dirty: false });
  }

  edit(fn: (s: Song) => Song, label: string) {
    if (!this.history) return;
    const next = fn(this.history.present);
    if (next === this.history.present) return;
    this.history.apply(next, label);
    this.autosaveDirty = true;
    this.set({ song: next, dirty: true });
  }

  undo() {
    if (!this.history?.canUndo) return;
    const s = this.history.undo();
    this.autosaveDirty = true;
    this.set({ song: s, dirty: true });
  }

  redo() {
    if (!this.history?.canRedo) return;
    const s = this.history.redo();
    this.autosaveDirty = true;
    this.set({ song: s, dirty: true });
  }

  // ----- edits -----
  setInstrument(trackId: string, instrumentId: string) {
    this.edit((s) => setInstrument(s, trackId, instrumentId), 'Change instrument');
  }
  setMixer(trackId: string, patch: Partial<Mixer>) {
    this.edit((s) => setMixer(s, trackId, patch), 'Track settings');
  }
  setDisplay(trackId: string, patch: { visible?: boolean; mode?: DisplayMode }) {
    this.edit((s) => setDisplay(s, trackId, patch), 'Track display');
  }
  transpose(semitones: number, trackId?: string) {
    this.edit((s) => transpose(s, semitones, trackId), trackId ? 'Transpose track' : 'Transpose song');
    if (!trackId) this.set({ transposeTotal: this.state.transposeTotal + semitones });
  }

  setPractice(p: Partial<Practice>) {
    this.set({ practice: { ...this.state.practice, ...p } });
  }

  // ----- autosave / recovery -----
  async autosaveNow(): Promise<boolean> {
    if (!this.state.song || !this.autosaveDirty) return false;
    this.autosaveDirty = false;
    const at = await window.mg.autosave(serializeProject(this.state.song));
    this.set({ lastAutosave: at });
    return true;
  }

  async checkRecovery() {
    const offer = await window.mg.recoveryOffer();
    if (offer) this.set({ recovery: offer });
  }

  restoreRecovery() {
    const r = this.state.recovery;
    if (!r) return;
    try {
      const song = parseProject(r.json);
      this.load(song, null, `${song.title} (recovered)`);
      this.set({ dirty: true });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
    void window.mg.recoveryDismiss();
    this.set({ recovery: null });
  }

  dismissRecovery() {
    void window.mg.recoveryDismiss();
    this.set({ recovery: null });
  }

  clearError() {
    this.set({ error: null });
  }
}
