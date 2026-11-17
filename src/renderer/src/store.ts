// App state: the song (through undo history), file path, and practice settings.
// All edits go through `edit()` so they are undoable and mark the project dirty.
import { importFile } from '../../import';
import {
  applyDetectedChords, clampCursor, defaultBand, detectChords, editedGeneratedTracks, generateBand, harmonySourceTracks,
  History, newSong, parseProject, regenerate, removeSection, ROLE_NAMES, serializeProject, setBacking, setCapo,
  setChordSymbol, setDisplay, setInstrument, setMixer, setPlayback, setRocksmithExport, setSection, setTuning,
  songFromRocksmith, splitTrack, transpose, withStyle, chartToSong, addHarmonyTrack, setKeyAt, removeKeyChange,
  setTimeSignatureAt, setTempoAt, setTempoRamp, removeTempoChange, newTrack, restMeasure, hashOf,
  type HarmonyInterval, type HarmonyDirection, type DrumPattern,
  type BackingTrack, type BandRole, type BandSettings, type Clip, type Cursor, type DisplayMode, type Mixer,
  type RocksmithExport, type RsImportReport, type RsReadResult, type Song, type StyleId,
  FX_DEFS, newEffect, presetEffects, songMix, absolutizeMedia, mediaDirFor, mediaFiles, relativizeMedia,
  type AutoLane, type Effect, type FxPreset, type FxType, type SongMix, type Track,
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
  /** Round 4: the track the composer dock works on (index). */
  selTrack: number;
  /** Open tab of the composer dock (null = closed). */
  dock: DockTab | null;
  /** Chord explorer: chord to show (set by clicking a chord symbol). */
  explore: string | null;
  /** New / edit chord chart dialog. */
  chart: { open: boolean; editing: boolean };
  /** Key / time / tempo changes dialog (bar to start at). */
  changesBar: number | null;
  /** Saved drum patterns (userData/settings.json). */
  drumPatterns: DrumPattern[];
  /** Round 5: user effect presets (userData/settings.json). */
  fxPresets: FxPreset[];
  /** Export dialog open. */
  exportOpen: boolean;
  /** Keyboard piano (computer keys play notes) on. */
  kbdPiano: boolean;
}

export type DockTab = 'roll' | 'drums' | 'chords' | 'prog' | 'midi' | 'mixer' | 'auto' | 'audio' | 'rec';

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
    selTrack: 0, dock: null, explore: null, chart: { open: false, editing: false }, changesBar: null, drumPatterns: [],
    fxPresets: [], exportOpen: false, kbdPiano: false,
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
      selTrack: Math.max(0, song.tracks.findIndex((t) => t.display.visible)), changesBar: null,
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
      const isProject = name.toLowerCase().endsWith('.mgproj');
      let song = importFile(name, bytes);
      // Audio clips are saved relative to <name>_media next to the project.
      if (isProject && path) song = absolutizeMedia(song, mediaDirFor(path));
      this.load(song, isProject ? path : null, name);
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  async openPath(path: string) {
    const ext = path.toLowerCase().split('.').pop() ?? '';
    if (ext === 'psarc' || ext === 'rs2dlc') return this.openRocksmith(path);
    if (ext === 'mgpack') {
      try {
        const project = await window.mg.unpack(path);
        await this.openPath(project);
        // Opened from a package: Save asks where to put it (the unpacked copy is temporary).
        this.set({ filePath: null, fileName: path.split(/[\\/]/).pop() ?? path, dirty: false });
      } catch (e) {
        this.set({ error: 'Could not open the package: ' + (e as Error).message });
      }
      return;
    }
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
    const path = (as ? null : this.state.filePath) ?? (await window.mg.savePath(song.title, 'mgproj', 'musicGenie project'));
    if (path) await this.saveTo(path);
  }

  /** Save to a path: audio clips are copied into <name>_media next to it and stored relative. */
  async saveTo(path: string): Promise<string> {
    const mediaDir = mediaDirFor(path);
    const files = mediaFiles(this.state.song!);
    const moved = new Map<string, string>();
    for (const f of files) {
      if (f.toLowerCase().startsWith(mediaDir.toLowerCase() + '\\')) continue;
      try { moved.set(f, await window.mg.copyInto(f, mediaDir)); } catch (e) { this.set({ error: 'Could not copy ' + f + ': ' + (e as Error).message }); }
    }
    if (moved.size) {
      this.edit((s) => ({
        ...s,
        tracks: s.tracks.map((t) => (t.audio ? { ...t, audio: { ...t.audio, clips: t.audio.clips.map((c) => ({ ...c, file: moved.get(c.file) ?? c.file })) } } : t)),
      }), 'Copy audio into the project folder');
    }
    const json = serializeProject(relativizeMedia(this.state.song!, mediaDir));
    const saved = await window.mg.saveProject(json, path, this.state.song!.title);
    if (saved) this.set({ filePath: saved, fileName: saved.split(/[\\/]/).pop() ?? saved, dirty: false });
    return saved ?? path;
  }

  /** One .mgpack file: the project and every audio file it uses. */
  async savePackage(out?: string | null): Promise<string | null> {
    const song = this.state.song;
    if (!song) return null;
    const path = out ?? (await window.mg.savePath(song.title, 'mgpack', 'musicGenie package (project + audio)'));
    if (!path) return null;
    const name = (path.split(/[\\/]/).pop() ?? 'song').replace(/\.[^.]+$/, '');
    const media: { file: string; as: string }[] = [];
    const used = new Set<string>();
    for (const f of mediaFiles(song)) {
      let as = f.split(/[\\/]/).pop() ?? 'audio';
      for (let k = 2; used.has(as.toLowerCase()); k++) as = as.replace(/(-\d+)?(\.[^.]+)?$/, '-' + k + '$2');
      used.add(as.toLowerCase());
      media.push({ file: f, as });
    }
    const map = new Map(media.map((m) => [m.file, m.as]));
    const rel: Song = {
      ...song,
      tracks: song.tracks.map((t) => (t.audio ? { ...t, audio: { ...t.audio, clips: t.audio.clips.map((c) => ({ ...c, file: map.get(c.file) ?? c.file })) } } : t)),
    };
    const r = await window.mg.pack({ out: path, name, json: serializeProject(rel), media });
    this.set({ info: 'Package saved: ' + path + ' (' + media.length + ' audio file' + (media.length === 1 ? '' : 's') + ').' });
    return r.path;
  }

  edit(fn: (s: Song) => Song, label: string, mergeKey?: string) {
    if (!this.history) return;
    const next = fn(this.history.present);
    if (next === this.history.present) return;
    this.history.apply(next, label, mergeKey);
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
    const no = this.confirmNo;
    this.confirmYes = null;
    this.confirmNo = null;
    this.set({ confirm: null });
    if (yes) fn?.();
    else no?.();
  }
  private confirmNo: (() => void) | null = null;
  /** Ask in the app and wait: true = the yes button, false = Cancel (or replaced by another question). */
  askAsync(message: string, yes: string): Promise<boolean> {
    this.confirmNo?.();
    return new Promise<boolean>((resolve) => {
      this.ask(message, yes, () => resolve(true));
      this.confirmNo = () => resolve(false);
    });
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
  setMixer(trackId: string, patch: Partial<Mixer>, mergeKey?: string) {
    const what = 'volume' in patch ? 'Volume' : 'pan' in patch ? 'Pan' : 'mute' in patch ? 'Mute' : 'solo' in patch ? 'Solo' : 'Track settings';
    const merge = mergeKey ?? ('volume' in patch || 'pan' in patch ? Object.keys(patch)[0] + ':' + trackId : undefined);
    this.edit((s) => setMixer(s, trackId, patch), what, merge);
  }

  // ----- Round 5: mixer, effects, automation -----
  /** Effects of a track, or of '__master' / '__reverb' / '__delay'. */
  fxOf(s: Song, target: string): Effect[] {
    const mix = songMix(s);
    if (target === '__master') return mix.master.fx;
    if (target === '__reverb') return [mix.reverb.fx];
    if (target === '__delay') return [mix.delay.fx];
    return s.tracks.find((t) => t.id === target)?.mixer.fx ?? [];
  }
  private withFx(s: Song, target: string, fx: Effect[]): Song {
    const mix = songMix(s);
    if (target === '__master') return { ...s, mix: { ...mix, master: { ...mix.master, fx } } };
    if (target === '__reverb') return { ...s, mix: { ...mix, reverb: { ...mix.reverb, fx: fx[0] } } };
    if (target === '__delay') return { ...s, mix: { ...mix, delay: { ...mix.delay, fx: fx[0] } } };
    return { ...s, tracks: s.tracks.map((t) => (t.id === target ? { ...t, mixer: { ...t.mixer, fx } } : t)) };
  }
  setFx(target: string, fn: (fx: Effect[]) => Effect[], label: string, mergeKey?: string) {
    this.edit((s) => this.withFx(s, target, fn(this.fxOf(s, target))), label, mergeKey);
  }
  addFx(target: string, type: FxType) {
    this.setFx(target, (fx) => [...fx, newEffect(type)], 'Add ' + FX_DEFS[type].name);
  }
  removeFx(target: string, id: string) {
    this.edit((s) => {
      const n = this.withFx(s, target, this.fxOf(s, target).filter((f) => f.id !== id));
      // Automation lanes of a removed effect go too.
      return { ...n, tracks: n.tracks.map((t) => (t.id === target && t.automation ? { ...t, automation: t.automation.filter((l) => !l.param.startsWith('fx:' + id + ':')) } : t)) };
    }, 'Remove effect');
  }
  moveFx(target: string, id: string, dir: -1 | 1) {
    this.setFx(target, (fx) => {
      const i = fx.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= fx.length) return fx;
      const n = [...fx];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    }, 'Move effect');
  }
  bypassFx(target: string, id: string, bypass: boolean) {
    this.setFx(target, (fx) => fx.map((f) => (f.id === id ? { ...f, bypass } : f)), bypass ? 'Bypass effect' : 'Enable effect');
  }
  setFxParam(target: string, id: string, key: string, value: number) {
    this.setFx(target, (fx) => fx.map((f) => (f.id === id ? { ...f, params: { ...f.params, [key]: value } } : f)), 'Effect setting', 'fx:' + target + ':' + id + ':' + key);
  }
  applyPreset(trackId: string, p: FxPreset) {
    this.edit((s) => ({
      ...s,
      tracks: s.tracks.map((t) => (t.id === trackId ? {
        ...t,
        mixer: { ...t.mixer, fx: presetEffects(p), sends: { reverb: p.sends?.reverb ?? 0, delay: p.sends?.delay ?? 0 } },
        automation: t.automation?.filter((l) => !l.param.startsWith('fx:')),
      } : t)),
    }), 'Preset ' + p.name);
  }
  async loadFxPresets() {
    const st = (await window.mg.settingsGet()) as { fxPresets?: FxPreset[] };
    this.set({ fxPresets: st.fxPresets ?? [] });
  }
  async saveFxPreset(trackId: string, name: string) {
    const t = this.state.song?.tracks.find((x) => x.id === trackId);
    if (!t || !name.trim()) return;
    const p: FxPreset = {
      name: name.trim(), family: 'any',
      fx: (t.mixer.fx ?? []).map((f) => ({ type: f.type, params: { ...f.params } })),
      sends: { ...(t.mixer.sends ?? { reverb: 0, delay: 0 }) },
    };
    const list = [...this.state.fxPresets.filter((x) => x.name !== p.name), p];
    await window.mg.settingsSet({ fxPresets: list });
    this.set({ fxPresets: list, info: 'Preset "' + p.name + '" saved.' });
  }
  setSends(trackId: string, patch: Partial<{ reverb: number; delay: number }>) {
    const key = Object.keys(patch)[0];
    this.edit((s) => ({
      ...s,
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, mixer: { ...t.mixer, sends: { reverb: 0, delay: 0, ...t.mixer.sends, ...patch } } } : t)),
    }), key === 'reverb' ? 'Reverb send' : 'Delay send', 'send:' + key + ':' + trackId);
  }
  setSongMix(fn: (m: SongMix) => SongMix, label: string, mergeKey?: string) {
    this.edit((s) => ({ ...s, mix: fn(songMix(s)) }), label, mergeKey);
  }
  setAutomation(trackId: string, fn: (lanes: AutoLane[]) => AutoLane[], label: string, mergeKey?: string) {
    this.edit((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, automation: fn(t.automation ?? []) } : t)) }), label, mergeKey);
  }
  /** Replace a track (audio clips and other whole-track edits). */
  updateTrack(trackId: string, fn: (t: Track) => Track, label: string, mergeKey?: string) {
    this.edit((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === trackId ? fn(t) : t)) }), label, mergeKey);
  }
  openExport(open: boolean) {
    this.set({ exportOpen: open });
  }
  setKbdPiano(on: boolean) {
    this.set({ kbdPiano: on });
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
    const cursor = c && song ? clampCursor(song, c) : null;
    this.set({ cursor, ...(cursor ? { selTrack: cursor.track } : {}) });
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

  // ----- Round 4: composition -----
  setSelTrack(i: number) {
    const song = this.state.song;
    if (!song) return;
    this.set({ selTrack: Math.max(0, Math.min(song.tracks.length - 1, i)) });
  }
  openDock(tab: DockTab | null) {
    this.set({ dock: tab });
  }
  exploreChord(name: string | null) {
    this.set({ explore: name, dock: 'chords', chordPicker: null });
  }
  /** Run an edit; report a thrown error in the app instead. */
  tryEdit(fn: (s: Song) => Song, label: string): boolean {
    try {
      this.edit(fn, label);
      return true;
    } catch (e) {
      this.set({ error: (e as Error).message });
      return false;
    }
  }
  openChart(open: boolean, editing = false) {
    this.set({ chart: { open, editing } });
  }
  /** New > Chord chart: build the song from the chart and generate the band in the chosen style. */
  createChart(text: string, opts: { title: string; bpm: number; style: StyleId; seed?: number }): string[] {
    const { song, errors } = chartToSong(text, { title: opts.title, bpm: opts.bpm });
    const band = withStyle(defaultBand('rock', undefined, opts.seed ?? 1), opts.style);
    band.players = band.players.map((p) => (p.role === 'lead' ? { ...p, on: false } : p));
    const full = generateBand(song, band);
    this.load(full, null, opts.title || 'Chord chart');
    this.set({ chart: { open: false, editing: false } });
    return errors;
  }
  /** Edit the chart of a chart song: bars, chords, sections and tempos are rebuilt and the band regenerated (one undo step). */
  rebuildChart(text: string, bpm: number): string[] {
    if (!this.state.song) return [];
    let errors: string[] = [];
    const ok = this.tryEdit((s) => {
      const r = chartToSong(text, { title: s.title, bpm });
      errors = r.errors;
      const band = s.band ?? defaultBand('rock');
      const fresh: Song = { ...r.song, title: s.title, artist: s.artist, album: s.album, composer: s.composer, playback: s.playback };
      const sameTs = (i: number) => i < s.bars.length && s.bars[i].timeSignature.numerator === fresh.bars[i].timeSignature.numerator
        && s.bars[i].timeSignature.denominator === fresh.bars[i].timeSignature.denominator;
      fresh.tracks = s.tracks.filter((t) => !t.generated).map((t) => ({
        ...t, staves: t.staves.map((st) => ({ ...st, measures: fresh.bars.map((b, i) => (sameTs(i) ? st.measures[i] : restMeasure(b))) })),
      }));
      return generateBand(fresh, band);
    }, 'Edit chord chart');
    if (ok) this.set({ chart: { open: false, editing: false } });
    return errors;
  }
  openChanges(bar: number | null) {
    this.set({ changesBar: bar });
  }
  setKeyChange(bar: number, fifths: number, mode: 'major' | 'minor') {
    this.tryEdit((s) => setKeyAt(s, bar, fifths, mode), 'Key change at bar ' + (bar + 1));
  }
  removeKeyChange(bar: number) {
    this.tryEdit((s) => removeKeyChange(s, bar), 'Remove key change');
  }
  /** Time signature change; band tracks nobody edited are regenerated in the same step. */
  setTimeSig(bar: number, num: number, den: number, count?: number) {
    this.tryEdit((s) => {
      const regen = !!s.band && s.tracks.some((t) => t.generated) && editedGeneratedTracks(s).length === 0;
      let n = setTimeSignatureAt(s, bar, num, den, count);
      if (regen) n = generateBand(n, n.band!);
      return n;
    }, 'Time signature ' + num + '/' + den + ' at bar ' + (bar + 1));
  }
  setTempoChange(bar: number, bpm: number, ramp?: { toBar: number; toBpm: number }) {
    this.tryEdit((s) => (ramp ? setTempoRamp(s, bar, ramp.toBar, ramp.toBpm, bpm) : setTempoAt(s, bar, bpm)),
      ramp ? (ramp.toBpm > bpm ? 'Accelerando' : 'Ritardando') + ' from bar ' + (bar + 1) : 'Tempo ' + bpm + ' at bar ' + (bar + 1));
  }
  removeTempoChange(bar: number) {
    this.tryEdit((s) => removeTempoChange(s, bar), 'Remove tempo change');
  }
  addHarmony(trackId: string, interval: HarmonyInterval, dir: HarmonyDirection) {
    this.tryEdit((s) => addHarmonyTrack(s, trackId, interval, dir), 'Add harmony');
  }
  /** Add an empty drum kit track (for the step sequencer). */
  addDrumTrack() {
    const ok = this.tryEdit((s) => {
      const n = structuredClone(s);
      let id = 'drums';
      for (let k = 2; n.tracks.some((t) => t.id === id); k++) id = 'drums' + k;
      n.tracks.push(newTrack(id, 'Drums', 0, true, [{ clef: 'neutral', measures: n.bars.map((b) => restMeasure(b)) }]));
      return n;
    }, 'Add drum track');
    if (ok) this.set({ selTrack: this.state.song!.tracks.length - 1 });
  }
  async loadDrumPatterns() {
    const st = (await window.mg.settingsGet()) as { drumPatterns?: DrumPattern[] };
    this.set({ drumPatterns: st.drumPatterns ?? [] });
  }
  async saveDrumPattern(p: DrumPattern) {
    const list = [...this.state.drumPatterns.filter((x) => x.name !== p.name), p];
    await window.mg.settingsSet({ drumPatterns: list });
    this.set({ drumPatterns: list, info: 'Pattern "' + p.name + '" saved.' });
  }
  async deleteDrumPattern(name: string) {
    const list = this.state.drumPatterns.filter((x) => x.name !== name);
    await window.mg.settingsSet({ drumPatterns: list });
    this.set({ drumPatterns: list });
  }
  showInfo(msg: string) {
    this.set({ info: msg });
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
