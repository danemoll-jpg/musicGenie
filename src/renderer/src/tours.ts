// Round 8: guided tours. Each step points at a real control; a step with `done` moves on by itself
// once the user has done it (or with Next). Tests drive them through window.mgTest.tour*.
import { useSyncExternalStore } from 'react';
import type { PlayerStatus } from './player';
import type { Store } from './store';

export interface TourStep {
  /** CSS selector of the control to point at (none = a general note). */
  target?: string;
  title: string;
  text: string;
  hint?: string;
  /** Runs when the step starts (open a menu, a panel…). `memo` keeps values between prepare and done. */
  prepare?: (store: Store, memo: Record<string, unknown>) => void | Promise<void>;
  /** True once the user has done what the step asks: the tour moves on by itself. */
  done?: (store: Store, status: PlayerStatus | null, memo: Record<string, unknown>) => boolean;
}
export interface Tour {
  id: string;
  title: string;
  what: string;
  steps: TourStep[];
}

// Avoid an import cycle with Shell.tsx (examples, menus): those are injected at start-up.
export const tourHooks: { openExample: (store: Store, id: string) => Promise<void>; openMenu: (id: string | null) => void } = {
  openExample: async () => {},
  openMenu: () => {},
};

const hasSong = (s: Store) => !!s.state.song;
async function ensureSong(store: Store, example = 'ode-to-joy') {
  if (!store.state.song) await tourHooks.openExample(store, example);
}

export const TOURS: Tour[] = [
  {
    id: 'first', title: 'The main tour', what: 'Open an example, see the score, change an instrument, add a band, play, make the music bigger',
    steps: [
      {
        target: '[data-example="ode-to-joy"]', title: 'Open some music',
        text: 'Everything starts with a song. Open “Ode to Joy” from the examples (later you can open your own files with File > Open, or start from chords or a description).',
        prepare: (s, m) => { m.load = s.state.loadId; if (s.state.song) s.showHome(true); },
        done: (s, _st, m) => hasSong(s) && s.state.loadId !== m.load,
      },
      {
        target: '.score', title: 'This is your song',
        text: 'The middle of the window shows the music as sheet music (and tabs for guitar and bass). Click a bar to start playing from there; drag over bars to select them.',
      },
      {
        target: '[data-tour="instrument"]', title: 'Choose an instrument',
        text: 'Each track on the left is one instrument. Pick another instrument here, e.g. turn the piano into an electric guitar. The notes stay; only the sound changes.',
        prepare: (s, m) => { if (!s.state.layout.leftOpen) s.setLayout({ leftOpen: true }); m.inst = s.state.song?.tracks[0]?.instrument.id; },
        done: (s, _st, m) => !!s.state.song && s.state.song.tracks[0]?.instrument.id !== m.inst,
      },
      {
        target: '[data-testid="generate"]', title: 'Add a band',
        text: 'The band panel (right) reads the chords and plays along: pick a style (rock, blues, jazz…) and press Generate. New tracks for drums, bass and more appear.',
        prepare: (s, m) => { s.setWorkspace('arrange'); s.setLayout({ rightOpen: true }); m.n = s.state.song?.tracks.filter((t) => t.generated).length ?? 0; },
        done: (s, _st, m) => (s.state.song?.tracks.filter((t) => t.generated).length ?? 0) > (m.n as number),
      },
      {
        target: '[data-tour="play"]', title: 'Play it',
        text: 'Press Play (or the space bar). The cursor follows the music. Slow it down with Speed, loop a hard part with Loop.',
        done: (_s, st) => !!st?.playing,
      },
      {
        target: '[data-tour="zoom-in"]', title: 'Make the music bigger',
        text: 'Use + / − (or Ctrl + mouse wheel) to zoom, or ⛶ Full score to show only the music. Esc brings everything back.',
        prepare: (_s, m) => { m.zoom = null; },
        done: (s) => s.state.layout.zoom !== 'fit' || s.state.fullScore,
      },
      {
        title: 'That\'s the main path',
        text: 'The tabs at the top are for what you\'re doing: Arrange (this), Write (notes, chords, drums, lyrics), Mix (volume, effects, export) and Recordings (turn audio into notes). Every “?” explains its panel; Help > More tours shows the rest.',
      },
    ],
  },
  {
    id: 'write', title: 'Writing notes', what: 'Enter notes on the score and in the piano roll',
    steps: [
      { target: '[data-ws="write"]', title: 'The Write workspace', text: 'Everything for entering and changing notes lives under Write.', prepare: (s) => ensureSong(s, 'twinkle'), done: (s) => s.state.workspace === 'write' },
      { target: '[data-testid="edit-toggle"]', title: 'Turn on note writing', text: 'Press ✎ Write notes. A bar of note lengths and techniques appears.', done: (s) => s.state.editMode },
      { target: '.score', title: 'Pick a spot', text: 'Click a note or rest in the score. A blue box shows where you are; ← → move along.', done: (s) => !!s.state.cursor },
      {
        target: '[data-testid="editbar"]', title: 'Type a note',
        text: 'Type a letter A-G for sheet music (or a fret number for tab). The length buttons (♩ ♪ …) change how long it lasts. Ctrl+Z undoes anything.',
        prepare: (s, m) => { m.song = s.state.song; },
        done: (s, _st, m) => s.state.song !== m.song,
      },
      { target: '[data-testid="dock-roll"]', title: 'Or draw notes', text: 'The piano roll lets you draw notes as bars on a keyboard grid: no music reading needed.', done: (s) => s.state.dock === 'roll' },
      { title: 'Done', text: 'The other tabs down there add drums (Drum grid), chords, chord suggestions, lyrics, and a MIDI or computer keyboard.' },
    ],
  },
  {
    id: 'chords', title: 'Starting from chords', what: 'Type chords, pick a style, hear the band',
    steps: [
      { target: '[data-testid="home-chords"]', title: 'Start from chords', text: 'On the Home screen (File > Home), choose “Start from chords”.', prepare: (s) => s.showHome(true), done: (s) => s.state.chart.open },
      { target: '[data-testid="chart-text"]', title: 'Type the chords', text: 'One bar between | marks, e.g. | C | Am | F | G |. [Verse] names a section; :| repeats.' },
      { target: '[data-testid="chart-style"]', title: 'Pick a style', text: 'Rock, blues, country, jazz or pop: it decides how the band plays.' },
      { target: '[data-testid="chart-create"]', title: 'Make the song', text: 'Press the button: the band plays your chords.', prepare: (_s, m) => { m.load = null; }, done: (s) => !s.state.chart.open && hasSong(s) },
      { target: '[data-tour="play"]', title: 'Listen', text: 'Press Play. Change the chords later with Song > Edit chord chart.', done: (_s, st) => !!st?.playing },
    ],
  },
  {
    id: 'mix', title: 'Mixing and exporting', what: 'Balance the instruments, add effects, export audio',
    steps: [
      { target: '[data-ws="mix"]', title: 'The Mix workspace', text: 'Volume, effects and export live under Mix.', prepare: (s) => ensureSong(s), done: (s) => s.state.workspace === 'mix' },
      { target: '[data-testid="dock-mixer"]', title: 'The mixer', text: 'One strip per instrument: drag a fader up or down to make it louder or quieter; M mutes, S plays it alone.', prepare: (s) => { if (s.state.dock !== 'mixer') s.openDock('mixer'); }, done: (s) => s.state.dock === 'mixer' },
      { target: '.strip', title: 'Effects', text: 'Each strip has its own effects (reverb, echo, EQ, distortion…). Add one with “+ effect”; the Reverb and Echo knobs send a bit of the track to shared effects.' },
      { target: '[data-testid="mix-export"]', title: 'Export', text: 'When it sounds right, export a WAV or MP3 (or each instrument separately, MIDI, PDF…). It is also in File > Export.', done: (s) => s.state.exportOpen },
      { title: 'Done', text: 'Close the export window when you\'re finished. “Changes over time” makes volume or effects change during the song (e.g. a fade-out).' },
    ],
  },
  {
    id: 'recording', title: 'Turning a recording into sheet music', what: 'From an MP3/WAV to notes you can edit',
    steps: [
      { target: '[data-ws="rec"]', title: 'The Recordings workspace', text: 'Everything for turning audio into notes is under Recordings.', done: (s) => s.state.workspace === 'rec' },
      { target: '[data-testid="wiz-load"]', title: '1. Load a recording', text: 'Choose an MP3 or WAV. It becomes the song\'s audio; nothing changes the file itself.', prepare: (s) => { if (s.state.dock !== 'rec') s.openDock('rec'); } },
      { target: '.wizard ol', title: '2-5. Step by step', text: 'Find the beat and bars, split the instruments, turn them into notes, then compare with the recording and fix what\'s wrong. Each step can be skipped or redone.' },
      { target: '[data-testid="omr-open"]', title: 'Printed music too', text: 'Have a PDF or photo of sheet music? “Read sheet music” turns it into a song as well.' },
      { title: 'Done', text: 'The result is a normal song: play it, change instruments, add a band, print it. Exporting to Rocksmith 2014 is an optional last step.' },
    ],
  },
  {
    id: 'rocksmith', title: 'Bonus: Rocksmith 2014 export', what: 'Play your guitar or bass part in Rocksmith',
    steps: [
      { target: '[data-menu="file"]', title: 'File > Export', text: 'Rocksmith export is in the File menu, under Export.', prepare: async (s) => { await ensureSong(s); tourHooks.openMenu('file'); } },
      { target: '[data-testid="rs-open"]', title: 'Rocksmith 2014…', text: 'Choose Rocksmith 2014… (open the Export submenu if it\'s closed).', prepare: () => tourHooks.openMenu('file:export'), done: (s) => s.state.rsExport.open },
      { target: '[data-testid="rs-dialog"]', title: 'Choose the parts', text: 'Pick which guitar/bass tracks become Rocksmith arrangements, the song info and the audio; then Export. Needs a guitar or bass track.' },
      { title: 'Done', text: 'The finished file goes to your Rocksmith “dlc” folder. Close this window when you\'re finished.' },
    ],
  },
];

export interface TourState { id: string; step: number; memo: Record<string, unknown> }

class TourCtl {
  state: TourState | null = null;
  /** The current step's prepare() has finished (its "already done?" can be judged). */
  prepared = false;
  /** Last finished/skipped tour (tests). */
  last: { id: string; finished: boolean } | null = null;
  private ls = new Set<() => void>();
  on(f: () => void) { this.ls.add(f); return () => this.ls.delete(f); }
  private emit() { this.ls.forEach((f) => f()); }
  start(id: string, store: Store) {
    if (!TOURS.some((t) => t.id === id)) return;
    this.state = { id, step: -1, memo: {} };
    this.go(0, store);
  }
  private go(i: number, store: Store) {
    const s = this.state;
    if (!s) return;
    const tour = TOURS.find((t) => t.id === s.id)!;
    if (i >= tour.steps.length) return this.stop(store, true);
    this.state = { ...s, step: i };
    this.prepared = false;
    this.emit();
    const memo = this.state.memo;
    delete memo['already' + i];
    void Promise.resolve(tour.steps[i].prepare?.(store, memo)).catch(() => {}).then(() => { if (this.state?.step === i) this.prepared = true; this.emit(); });
  }
  next(store: Store) { if (this.state) this.go(this.state.step + 1, store); }
  back(store: Store) { if (this.state && this.state.step > 0) this.go(this.state.step - 1, store); }
  stop(store: Store, finished: boolean) {
    if (!this.state) return;
    this.last = { id: this.state.id, finished };
    if (this.state.id === 'first') void window.mg.settingsSet({ tourDone: true });
    this.state = null;
    tourHooks.openMenu(null);
    void store;
    this.emit();
  }
}
export const tourCtl = new TourCtl();
export function useTour(): TourState | null {
  return useSyncExternalStore((f) => tourCtl.on(f), () => tourCtl.state);
}
