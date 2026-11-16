// window.mgTest: driven by tests/e2e (only installed with --hidden).
import {
  countNoteOnsets, serializeProject, songLengthMs, tempoPoints, tickAtMs, trackEvents, type BandRole, type BandSettings, type Cursor,
  type RocksmithExport, type StyleId,
} from '../../model';
import type { BackingPlayer } from './audio/backing';
import { getMasterGain, measureLevels, setMasterGain } from './audio/masterBus';
import { renderMix, wavBytes, wavLengthMs } from './audio/render';
import type { ScorePlayer } from './player';
import { exportRocksmith } from './rocksmithExport';
import type { Store } from './store';

export function installTestApi(store: Store, getPlayer: () => ScorePlayer | null, getBacking: () => BackingPlayer | null = () => null) {
  const player = () => {
    const p = getPlayer();
    if (!p) throw new Error('player not created yet');
    return p;
  };
  const api = {
    hasPlayer: () => !!getPlayer(),
    async open(path: string) {
      const p = player();
      const rendered = p.waitForRender();
      await store.openPath(path);
      if (store.state.error) throw new Error(store.state.error);
      await rendered;
      return api.state();
    },
    async waitRender() {
      await player().waitForRender();
    },
    waitReady(timeoutMs = 30000) {
      return new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          if (player().status.ready) resolve(true);
          else if (performance.now() - t0 > timeoutMs) resolve(false);
          else setTimeout(tick, 100);
        };
        tick();
      });
    },
    state() {
      const s = store.state;
      const p = getPlayer()?.status;
      return {
        title: s.song?.title,
        bars: s.song?.bars.length,
        notes: s.song ? countNoteOnsets(s.song) : 0,
        tracks: s.song?.tracks.map((t) => ({
          name: t.name, instrument: t.instrument.id, program: t.instrument.program, mode: t.display.mode,
          visible: t.display.visible, mixer: t.mixer, tuning: t.tuning,
        })),
        canUndo: s.canUndo, canRedo: s.canRedo, dirty: s.dirty,
        recoveryOffered: !!s.recovery, lastAutosave: s.lastAutosave, transposeTotal: s.transposeTotal,
        practice: s.practice, player: p, masterGain: getMasterGain(),
        band: s.band, confirm: s.confirm, chordPicker: s.chordPicker, soundFontPath: s.soundFontPath, info: s.info, error: s.error,
        chords: s.song?.chordSymbols.length ?? 0, sections: s.song?.sections, swing: s.song?.playback?.swing ?? 0,
        generated: s.song?.tracks.filter((t) => t.generated).map((t) => ({ name: t.name, role: t.generated!.role, seed: t.generated!.seed })),
        bannerVisible: !!document.querySelector('[data-testid="recovery-banner"]'),
      };
    },
    song: () => structuredClone(store.state.song),
    play: () => player().play(),
    pause: () => player().pause(),
    stop: () => player().stop(),
    seekBar: (bar: number) => player().seekBar(bar),
    selectBars: (a: number, b: number) => player().selectBars(a, b),
    setPractice: (p: Parameters<Store['setPractice']>[0]) => store.setPractice(p),
    setInstrument: (trackIndex: number, id: string) => store.setInstrument(store.state.song!.tracks[trackIndex].id, id),
    setDisplay: (trackIndex: number, patch: Parameters<Store['setDisplay']>[1]) =>
      store.setDisplay(store.state.song!.tracks[trackIndex].id, patch),
    setMixer: (trackIndex: number, patch: Parameters<Store['setMixer']>[1]) =>
      store.setMixer(store.state.song!.tracks[trackIndex].id, patch),
    soloTrackOnly: (trackIndex: number) => {
      store.state.song!.tracks.forEach((t, i) => store.setDisplay(t.id, { visible: i === trackIndex }));
    },
    transpose: (n: number, trackIndex?: number) =>
      store.transpose(n, trackIndex === undefined ? undefined : store.state.song!.tracks[trackIndex].id),
    undo: () => store.undo(),
    redo: () => store.redo(),
    autosaveNow: () => store.autosaveNow(),
    levels: (ms: number) => measureLevels(ms),
    setMasterGain: (g: number) => setMasterGain(g),
    // ----- Round 2 -----
    detectChords: (replace: boolean) => store.detectChords(replace),
    setChord: (bar: number, tick: number, name: string | null) => store.setChord(bar, tick, name),
    splitTrack: (trackIndex: number) => store.splitTrack(store.state.song!.tracks[trackIndex].id),
    setSection: (a: number, b: number, name: string) => store.setSection(a, b, name),
    removeSection: (bar: number) => store.removeSection(bar),
    setBand: (patch: Partial<BandSettings>) => store.setBand(patch),
    setStyle: (style: StyleId) => store.setStyle(style),
    setPlayer: (role: BandRole, patch: Parameters<Store['setPlayer']>[1]) => store.setPlayer(role, patch),
    /** Press the panel's Generate button (the real UI path). */
    clickGenerate() {
      (document.querySelector('[data-testid="generate"]') as HTMLButtonElement).click();
    },
    tryAnother: () => store.tryAnother(),
    regenerate: (target: { sectionStartBar?: number; role?: BandRole }) => store.regenerate(target),
    answer: (yes: boolean) => store.answer(yes),
    setSwing: (v: number) => store.setSwing(v),
    chooseSoundFont: (path: string) => store.chooseSoundFont(path),
    useDefaultSoundFont: () => store.useDefaultSoundFont(),
    waitSoundFontLoads: (n: number, ms = 30000) => player().waitSoundFontLoads(n, ms),
    /** Save the project to a path without a dialog; returns the path. */
    saveTo: (path: string) => window.mg.saveProject(serializeProject(store.state.song!), path, 'test'),
    serialized: () => serializeProject(store.state.song!),
    /** Click the drawn chord symbol (the n-th <text> in the score whose text is a chord name). */
    clickChordSymbol(name: string) {
      const el = [...document.querySelectorAll('.at-host text')].find((t) => t.textContent?.trim() === name) as SVGTextElement | undefined;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return true;
    },
    /** Choose a chord in the open picker with its selects, then press its Set button. */
    pickInChordPicker(root: number, quality: string) {
      const picker = document.querySelector('[data-testid="chord-picker"]');
      if (!picker) return false;
      const [rootSel, qSel] = [...picker.querySelectorAll('select')] as HTMLSelectElement[];
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(rootSel, String(root));
      rootSel.dispatchEvent(new Event('change', { bubbles: true }));
      setter.call(qSel, quality);
      qSel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    applyChordPicker() {
      (document.querySelector('[data-testid="chord-apply"]') as HTMLButtonElement).click();
    },
    // ----- Round 3 -----
    newSong: (kind: 'guitar' | 'bass') => store.newSong(kind),
    setEditMode: (on: boolean) => store.setEditMode(on),
    setCursor: (c: Cursor) => store.setCursor(c),
    cursor: () => store.state.cursor,
    /** Notes of a track in time order: [start tick, pitch, string, fret, technique names]. */
    notesOf(trackIndex: number) {
      const song = store.state.song!;
      return trackEvents(song, song.tracks[trackIndex]).map((e) => [e.start, e.pitch, e.string ?? null, e.fret ?? null, Object.keys(e.techniques ?? {}).sort().join(',')]);
    },
    onsets: (trackIndex?: number) => countNoteOnsets(store.state.song!, trackIndex),
    setTuning: (trackIndex: number, pitches: number[], mode: 'keepPitch' | 'keepFrets') =>
      store.setTuning(store.state.song!.tracks[trackIndex].id, pitches, mode),
    setCapo: (trackIndex: number, capo: number) => store.setCapo(store.state.song!.tracks[trackIndex].id, capo),
    rs: (cmd: string, args: unknown) => window.mg.rs(cmd, args),
    rsImport: () => store.state.rsImport,
    backing: () => ({ status: getBacking()?.status ?? null, probe: getBacking()?.probe() ?? null, track: store.state.song?.backing ?? null }),
    setBacking: (patch: Parameters<Store['setBacking']>[0]) => store.setBacking(patch),
    songLengthMs: () => songLengthMs(store.state.song!),
    /** Put the player at a time in the song (ms after bar 1). */
    seekSongMs(ms: number) {
      const t = tickAtMs(tempoPoints(store.state.song!), ms);
      player().api.tickPosition = Math.max(0, Math.round(t));
    },
    /** A key press as the app sees it (window keydown), without needing OS focus. */
    key(key: string, mods: { shift?: boolean; ctrl?: boolean } = {}) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, bubbles: true, cancelable: true }));
    },
    /** Render the song offline (never through the speakers); optionally write the WAV. */
    async renderAudio(excludeTrackIndices: number[] = [], wavPath?: string) {
      const song = store.state.song!;
      const r = await renderMix(player(), song, excludeTrackIndices.map((i) => song.tracks[i].id));
      const wav = wavBytes(r.samples, r.sampleRate);
      if (wavPath) await window.mg.writeBytes(wavPath, wav);
      let peak = 0;
      for (let i = 0; i < r.samples.length; i += 7) peak = Math.max(peak, Math.abs(r.samples[i]));
      return { wavMs: wavLengthMs(wav), songMs: songLengthMs(song), synthEndMs: r.synthEndMs, renderMs: r.renderMs, peak };
    },
    setExportDir: (dir: string | null) => { store.exportDirOverride = dir; },
    openRsExport: (open: boolean) => store.openRsExport(open),
    rsExportState: () => store.state.rsExport,
    async exportRocksmith(settings: RocksmithExport, outDir: string) {
      return exportRocksmith(player(), store.state.song!, settings, { outDir });
    },
    scrollScoreToBar(bar: number) {
      const p = player();
      const lookup = p.api.boundsLookup;
      const mb = lookup?.findMasterBarByIndex(bar);
      const el = document.querySelector('.score') as HTMLElement;
      if (mb && el) el.scrollTop = Math.max(0, mb.realBounds.y - 40);
    },
  };
  (window as unknown as { mgTest: typeof api }).mgTest = api;
}
