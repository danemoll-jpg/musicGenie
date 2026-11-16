// App state: the song (through undo history), file path, and practice settings.
// All edits go through `edit()` so they are undoable and mark the project dirty.
import { importFile } from '../../import';
import {
  applyDetectedChords, clampCursor, defaultBand, detectChords, editedGeneratedTracks, generateBand, harmonySourceTracks,
  History, newSong, parseProject, regenerate, removeSection, ROLE_NAMES, serializeProject, setBacking, setCapo,
  setChordSymbol, setDisplay, setInstrument, setMixer, setPlayback, setRocksmithExport, setSection, setTuning,
  songFromRocksmith, splitTrack, transpose, withStyle,
  type BackingTrack, type BandRole, type BandSettings, type Clip, type Cursor, type DisplayMode, type Mixer,
  type RocksmithExport, type RsImportReport, type RsReadResult, type Song, type StyleId,
} from '../../model';
import type { RsExportResult } from './rocksmithExport';

type RsArr = RsReadResult['arrangements'][0];

/** What the last Rocksmith import found (for the status line and tests). */
export interface RsImportSummary {
  file: string;
  arrangements: { name: string; levels?: number; hardest?: RsArr['hardest']; sourceXmlHardest?: RsArr['sourceXmlHardest']; notes: number; chords: number }[];
  report: RsImportReport;
  audio: string | null;
}

export interface RsExportState {
  open: boolean;
  running: boolean;
  step: string | null;
  result: RsExportResult | null;
  error: string | null;
}

/** A Rocksmith arrangement XML (root <song>) rather than MusicXML. */
export function isRocksmithXml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 2048));
  return /<song[\s>]/.test(head) && !/score-(partwise|timewise)/.test(head);
}

/** Next seed for "Try another" / Regenerate: deterministic sequence, never 0. */
export function nextSeed(seed: number): number {
  return ((Math.imul(seed || 1, 1103515245) + 12345) >>> 1) % 2147483647 || 1;
}

export interface ChordPicker {
  bar: number;
  tick: number;
  name: string | null;
  /** Position in the score panel (px). */
  x: number;
  y: number;
}

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
  /** Band panel setup (written into the song on Generate). */
  band: BandSettings | null;
  /** A yes/no question shown in the app (never a native dialog). */
  confirm: { message: string; yes: string } | null;
  chordPicker: ChordPicker | null;
  /** User SoundFont path to use, or null for the bundled default. */
  soundFontPath: string | null;
  info: string | null;
  /** Note editing: clicks select beats, keys type notes. */
  editMode: boolean;
  cursor: Cursor | null;
  hasClip: boolean;
  /** Busy message while a long job (Rocksmith import) runs. */
  busy: string | null;
  rsImport: RsImportSummary | null;
  rsExport: RsExportState;
  /** Track whose custom-tuning dialog is open. */
  tuningTrack: string | null;
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
    band: null, confirm: null, chordPicker: null, soundFontPath: null, info: null,
    editMode: false, cursor: null, hasClip: false, busy: null, rsImport: null,
    rsExport: { open: false, running: false, step: null, result: null, error: null }, tuningTrack: null,
  };
  private clip: Clip | null = null;
  /** Tests only: export into this folder instead of Documents\musicGenie\Rocksmith. */
  exportDirOverride: string | null = null;
  private confirmYes: (() => void) | null = null;

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
    const band = song.band ? structuredClone(song.band) : defaultBand('rock', harmonySourceTracks(song)[0]?.id, 1);
    this.set({
      song, filePath, fileName, dirty: false, error: null, transposeTotal: 0, loadId: this.state.loadId + 1,
      band, confirm: null, chordPicker: null, info: null, cursor: null, rsImport: null, tuningTrack: null,
      rsExport: { open: false, running: false, step: null, result: null, error: null },
    });
    const sf = song.playback?.soundFont;
    if (sf) {
      void window.mg.fileExists(sf).then((ok) => {
        if (ok) this.set({ soundFontPath: sf });
        else this.set({ error: 'This project\'s SoundFont was not found (' + sf + '). Using the current one.' });
      });
    }
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
    const ext = path.toLowerCase().split('.').pop() ?? '';
    if (ext === 'psarc' || ext === 'rs2dlc') return this.openRocksmith(path);
    const f = await window.mg.readFile(path);
    if (ext === 'xml' && isRocksmithXml(f.bytes)) return this.openRocksmith(path);
    this.openBytes(f.name, f.path, f.bytes);
  }

  /** Open a Rocksmith .psarc, a DLC Builder .rs2dlc project or a Rocksmith arrangement .xml. */
  async openRocksmith(path: string) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.toLowerCase().split('.').pop();
    this.set({ busy: 'Opening ' + name + '…', error: null });
    const off = window.mg.onRsProgress((m) => this.set({ busy: 'Opening ' + name + ': ' + m + '…' }));
    try {
      const { userData } = await window.mg.paths();
      const folder = name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
      const outDir = userData + '\\rocksmith-import\\' + folder;
      const cmd = ext === 'psarc' ? 'read' : ext === 'rs2dlc' ? 'readProject' : 'readXml';
      const r = await window.mg.rs<RsReadResult>(cmd, { psarc: path, rs2dlc: path, xml: path, outDir });
      const { song, report } = songFromRocksmith(r);
      this.load(song, null, name);
      this.set({
        rsImport: {
          file: path,
          arrangements: r.arrangements.map((a) => ({
            name: a.name, levels: a.levels, hardest: a.hardest, sourceXmlHardest: a.sourceXmlHardest,
            notes: a.notes.length, chords: a.chords.length,
          })),
          report,
          audio: song.backing?.path ?? null,
        },
      });
    } catch (e) {
      this.set({ error: 'Could not open ' + name + ': ' + (e as Error).message });
    } finally {
      off();
      this.set({ busy: null });
    }
  }

  newSong(kind: 'guitar' | 'bass') {
    this.load(newSong(kind), null, kind === 'bass' ? 'New bass song' : 'New guitar song');
    this.set({ editMode: true, cursor: { track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 } });
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
  private editWithBand(fn: (s: Song) => Song, label: string) {
    this.edit(fn, label);
    const b = this.state.song?.band;
    if (b) this.set({ band: structuredClone(b) });
  }

  /** Ask in the app; run `fn` on yes. */
  ask(message: string, yes: string, fn: () => void) {
    this.confirmYes = fn;
    this.set({ confirm: { message, yes } });
  }
  answer(yes: boolean) {
    const fn = this.confirmYes;
    this.confirmYes = null;
    this.set({ confirm: null });
    if (yes) fn?.();
  }

  // band
  setBand(patch: Partial<BandSettings>) {
    if (this.state.band) this.set({ band: { ...this.state.band, ...patch } });
  }
  setStyle(style: StyleId) {
    if (this.state.band) this.set({ band: withStyle(this.state.band, style) });
  }
  setPlayer(role: BandRole, patch: Partial<BandSettings['players'][0]>) {
    const b = this.state.band;
    if (!b) return;
    this.set({ band: { ...b, players: b.players.map((p) => (p.role === role ? { ...p, ...patch } : p)) } });
  }

  private editedMessage(names: string[], action: string) {
    return names.join(', ') + (names.length > 1 ? ' were' : ' was') + ' edited by hand. ' + action + '?';
  }

  /** Generate the whole band. Asks first if a generated track was edited by hand. */
  generate(force = false) {
    const song = this.state.song;
    const band = this.state.band;
    if (!song || !band) return;
    const edited = editedGeneratedTracks(song);
    if (edited.length && !force) {
      this.ask(this.editedMessage(edited.map((t) => t.name), 'Replace with newly generated parts'), 'Replace', () => this.generate(true));
      return;
    }
    this.editWithBand((s) => generateBand(s, band), 'Generate band (' + band.style + ')');
  }

  tryAnother() {
    if (!this.state.band) return;
    this.setBand({ seed: nextSeed(this.state.band.seed) });
    this.generate();
  }

  /** Regenerate one section (all players or one) or one player (whole song) with a new seed. */
  regenerate(target: { sectionStartBar?: number; role?: BandRole }, force = false) {
    const song = this.state.song;
    if (!song?.band) return;
    const edited = editedGeneratedTracks(song, target.role);
    if (edited.length && !force) {
      this.ask(this.editedMessage(edited.map((t) => t.name), 'Regenerate anyway'), 'Regenerate', () => this.regenerate(target, true));
      return;
    }
    const tags = song.tracks.filter((t) => t.generated && (!target.role || t.generated.role === target.role));
    if (!tags.length) return;
    const g = tags[0].generated!;
    const seed = nextSeed(
      target.sectionStartBar !== undefined ? g.sectionSeeds?.[String(target.sectionStartBar)] ?? g.seed + target.sectionStartBar : g.seed,
    );
    const what = target.role ? ROLE_NAMES[target.role] : 'band';
    const where = target.sectionStartBar !== undefined ? ' (section at bar ' + (target.sectionStartBar + 1) + ')' : '';
    this.editWithBand((s) => regenerate(s, target, seed), 'Regenerate ' + what + where);
  }

  // chords
  detectChords(replace: boolean) {
    const song = this.state.song;
    if (!song) return;
    this.edit((s) => applyDetectedChords(s, detectChords(s), replace), replace ? 'Detect chords (replace)' : 'Detect chords');
    const n = this.state.song!.chordSymbols.filter((c) => c.source === 'detected').length;
    const kept = !replace && song.chordSymbols.some((c) => c.source !== 'detected');
    this.set({ info: n + ' chord' + (n === 1 ? '' : 's') + ' recognised' + (kept ? ' (chords from the file kept; tick "Replace" to overwrite them).' : '.') });
  }
  setChord(bar: number, tick: number, name: string | null) {
    this.edit((s) => setChordSymbol(s, bar, tick, name), name ? 'Change chord' : 'Remove chord');
    this.set({ chordPicker: null });
  }
  openChordPicker(p: ChordPicker | null) {
    this.set({ chordPicker: p });
  }

  // sections, split, feel
  setSection(startBar: number, endBar: number, name: string) {
    this.edit((s) => setSection(s, startBar, endBar, name), 'Section ' + name);
  }
  removeSection(bar: number) {
    this.edit((s) => removeSection(s, bar), 'Remove section');
  }
  splitTrack(trackId: string) {
    try {
      this.edit((s) => splitTrack(s, trackId), 'Split into band parts');
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }
  setSwing(amount: number) {
    this.edit((s) => setPlayback(s, { swing: amount }), 'Swing');
  }

  // SoundFont (remembered in app settings; also stored in the open project)
  async initSettings() {
    const st = await window.mg.settingsGet();
    if (st.soundFont && (await window.mg.fileExists(st.soundFont)) && !this.state.song?.playback?.soundFont) {
      this.set({ soundFontPath: st.soundFont });
    }
  }
  async chooseSoundFont(path?: string) {
    const p = path ?? (await window.mg.pickSoundFont());
    if (!p) return;
    await window.mg.settingsSet({ soundFont: p });
    this.set({ soundFontPath: p });
    if (this.state.song) this.edit((s) => setPlayback(s, { soundFont: p }), 'Change SoundFont');
  }
  async useDefaultSoundFont() {
    await window.mg.settingsSet({ soundFont: null });
    this.set({ soundFontPath: null });
    if (this.state.song?.playback?.soundFont) this.edit((s) => setPlayback(s, { soundFont: null }), 'Default SoundFont');
  }
  clearInfo() {
    this.set({ info: null });
  }

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

  // ----- note editing -----
  setEditMode(on: boolean) {
    const song = this.state.song;
    let cursor = this.state.cursor;
    if (on && song && !cursor) {
      const ti = Math.max(0, song.tracks.findIndex((t) => t.display.visible));
      cursor = clampCursor(song, { track: ti, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 });
    }
    this.set({ editMode: on, cursor });
  }
  setCursor(c: Cursor | null) {
    const song = this.state.song;
    this.set({ cursor: c && song ? clampCursor(song, c) : null });
  }
  /** Run a cursor edit as one undoable step; keeps the cursor inside the song. */
  editAt(fn: (s: Song, c: Cursor) => Song, label: string, moveTo?: (s: Song, c: Cursor) => Cursor) {
    const c = this.state.cursor;
    if (!c || !this.state.song) return;
    try {
      this.edit((s) => fn(s, c), label);
      const s = this.state.song!;
      this.set({ cursor: clampCursor(s, moveTo ? moveTo(s, c) : c) });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }
  setClip(clip: Clip | null) {
    this.clip = clip;
    this.set({ hasClip: !!clip });
  }
  getClip() {
    return this.clip;
  }

  // ----- tunings -----
  setTuning(trackId: string, tuning: number[], mode: 'keepPitch' | 'keepFrets') {
    try {
      this.edit((s) => setTuning(s, trackId, tuning, mode), 'Tuning');
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }
  setCapo(trackId: string, capo: number) {
    this.edit((s) => setCapo(s, trackId, capo), capo ? 'Capo ' + capo : 'No capo');
  }
  openTuningDialog(trackId: string | null) {
    this.set({ tuningTrack: trackId });
  }

  // ----- backing track -----
  setBacking(patch: Partial<BackingTrack> | null) {
    this.edit((s) => setBacking(s, patch), patch === null ? 'Remove recording' : 'Recording settings');
  }

  // ----- Rocksmith export -----
  openRsExport(open: boolean) {
    this.set({ rsExport: { ...this.state.rsExport, open } });
  }
  saveRsSettings(s: RocksmithExport) {
    if (JSON.stringify(this.state.song?.rocksmith) !== JSON.stringify(s)) this.edit((x) => setRocksmithExport(x, s), 'Rocksmith export settings');
  }
  setRsExport(p: Partial<RsExportState>) {
    this.set({ rsExport: { ...this.state.rsExport, ...p } });
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

  showError(message: string) {
    this.set({ error: message });
  }

  clearError() {
    this.set({ error: null });
  }
}
