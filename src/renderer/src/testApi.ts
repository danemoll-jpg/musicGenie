// window.mgTest: driven by tests/e2e (only installed with --hidden).
import { countNoteOnsets, serializeProject, type BandRole, type BandSettings, type StyleId } from '../../model';
import { getMasterGain, measureLevels, setMasterGain } from './audio/masterBus';
import type { ScorePlayer } from './player';
import type { Store } from './store';

export function installTestApi(store: Store, getPlayer: () => ScorePlayer | null) {
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
