// window.mgTest: driven by tests/e2e (only installed with --hidden).
import { countNoteOnsets } from '../../model';
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
