// Round 8 additions to window.mgTest (only installed with --hidden): layout, tours, help, menus.
import { HELP_TOPICS } from './help';
import { helpCtl } from './HelpUi';
import { EXAMPLES, menuCtl, openExample } from './Shell';
import { TOURS, tourCtl } from './tours';
import type { Layout, Store, Workspace } from './store';
import type { ScorePlayer } from './player';

export function installTestApiR8(store: Store, getPlayer: () => ScorePlayer | null) {
  const api = {
    layout: () => store.state.layout,
    setLayout: (p: Partial<Layout>) => store.setLayout(p),
    resetLayout: () => store.resetLayout(),
    workspace: () => store.state.workspace,
    setWorkspace: (w: Workspace) => store.setWorkspace(w),
    fullScore: (on: boolean) => store.setFullScore(on),
    showHome: (on: boolean) => store.showHome(on),
    ui: () => ({ workspace: store.state.workspace, dock: store.state.dock, home: store.state.home, fullScore: store.state.fullScore, editMode: store.state.editMode,
      chart: store.state.chart.open, describe: store.state.describeOpen, exportOpen: store.state.exportOpen, rs: store.state.rsExport.open, recent: store.state.recent }),
    scale: () => getPlayer()?.scale ?? null,
    examples: () => EXAMPLES.map((e) => e.id),
    openExample: (id: string) => openExample(store, id),
    /** Next "Open…" answers with this path instead of showing the native dialog (null = cancel). */
    answerOpenDialog: (path: string | null) => { store.dialogOverride = async () => path; },
    menu: (id: string | null) => menuCtl.set(id),
    closeDialogs: () => { store.openChart(false); store.openDescribe(false); store.openExport(false); store.openRsExport(false); store.openChanges(null); store.openTuningDialog(null); store.openChordPicker(null); helpCtl.open(null); menuCtl.set(null); },
    openDialogKind: (k: string) => {
      const s = store.state.song;
      if (k === 'chart') store.openChart(true);
      else if (k === 'describe') store.openDescribe(true);
      else if (k === 'changes') store.openChanges(0);
      else if (k === 'export') store.openExport(true);
      else if (k === 'rs') store.openRsExport(true);
      else if (k === 'tuning') { const t = s?.tracks.find((x) => x.tuning); if (t) store.openTuningDialog(t.id); }
      else if (k === 'chordpicker') store.openChordPicker({ bar: 0, tick: 0, name: 'C', x: 40, y: 40 });
      else if (k === 'confirm') store.ask('Test question?', 'Yes', () => {});
    },
    help: (topic: string | null) => helpCtl.open(topic),
    helpTopics: () => HELP_TOPICS.map((t) => ({ id: t.id, steps: t.steps.length, area: t.area })),
    tours: () => TOURS.map((t) => ({ id: t.id, steps: t.steps.length })),
    tourStart: (id: string) => tourCtl.start(id, store),
    tourStop: () => tourCtl.stop(store, false),
    tourState: () => {
      const s = tourCtl.state;
      if (!s) return { running: false, last: tourCtl.last };
      const st = TOURS.find((t) => t.id === s.id)!.steps[s.step];
      return { running: true, id: s.id, step: s.step, target: st?.target ?? null, waits: !!st?.done && s.memo['already' + s.step] === false, judged: s.memo['already' + s.step] !== undefined, found: st?.target ? !!document.querySelector(st.target) : null, last: tourCtl.last };
    },
  };
  const w = window as unknown as { mgTest: Record<string, unknown> };
  Object.assign(w.mgTest, api);
}
