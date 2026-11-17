// Round 8: the app shell — menu bar, workspace tabs, play bar, Home screen, help viewer, tours.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { msAtTick, songEndTick, tempoPoints } from '../../model';
import { importFile } from '../../import';
import { KbdPianoToggle } from './Round4';
import { SettingsMenu } from './Overlays';
import { HelpButton, helpCtl, useHelpTopic } from './HelpUi';
import { GLOSSARY, HELP_TOPICS } from './help';
import { analysisCtl, playerCtl } from './Round6';
import { reviewCtl } from './Review';
import { omrCtl } from './omr';
import { DEFAULT_SOUNDFONT, type PlayerStatus, type ScorePlayer } from './player';
import { TOURS, tourCtl, useTour } from './tours';
import { WORKSPACES, type AppState, type Store, type Workspace } from './store';

// ---------------------------------------------------------------- examples
export const EXAMPLES: { id: string; title: string; what: string; file?: string; chart?: { text: string; bpm: number; style: 'blues' } }[] = [
  { id: 'ode-to-joy', title: 'Ode to Joy (Beethoven)', what: 'Piano, two hands, with chords: the band can play along', file: 'ode-to-joy.musicxml' },
  { id: 'bach-prelude', title: 'Prelude in C (Bach)', what: 'Flowing piano piece from a MIDI file', file: 'bach-prelude-in-c.mid' },
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star (folk tune)', what: 'A melody with chord symbols: good for trying the band', file: 'twinkle-twinkle.musicxml' },
  {
    id: 'blues', title: '12-bar blues in A', what: 'Just chords: the blues band plays them',
    chart: { bpm: 100, style: 'blues', text: '{key: A} {tempo: 100}\n[Blues]\n|: A7 | D7 | A7 | A7 |\n| D7 | D7 | A7 | A7 |\n| E7 | D7 | A7 | E7 :|\n' },
  },
];

export async function openExample(store: Store, id: string) {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  if (ex.chart) {
    store.createChart(ex.chart.text, { title: ex.title, bpm: ex.chart.bpm, style: ex.chart.style });
    return;
  }
  try {
    const r = await fetch(new URL('examples/' + ex.file, location.href).href);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    // Examples open under their own title (a MIDI file's track name is not one).
    const song = importFile(ex.file!, new Uint8Array(await r.arrayBuffer()));
    store.load({ ...song, title: ex.title }, null, ex.title);
  } catch (e) {
    store.showError('Could not open the example: ' + (e as Error).message);
  }
}

// ---------------------------------------------------------------- menus
class MenuCtl {
  open: string | null = null;
  private ls = new Set<() => void>();
  on(f: () => void) { this.ls.add(f); return () => this.ls.delete(f); }
  set(id: string | null) { this.open = id; this.ls.forEach((f) => f()); }
}
export const menuCtl = new MenuCtl();
const useMenu = () => useSyncExternalStore((f) => menuCtl.on(f), () => menuCtl.open);

export interface MenuItem {
  label?: string;
  title?: string;
  key?: string;
  testId?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
  sub?: MenuItem[];
  sep?: boolean;
}

function MenuList({ items, depth, want }: { items: MenuItem[]; depth: number; want?: string }) {
  const [sub, setSub] = useState<number | null>(null);
  // menuCtl.set('file:export') opens File with its Export submenu (tours).
  useEffect(() => {
    if (!want) return;
    const i = items.findIndex((it) => it.sub && it.label?.toLowerCase().startsWith(want));
    if (i >= 0) setSub(i);
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`mbar-list ${depth ? 'sub' : ''}`} role="menu">
      {items.map((it, i) => it.sep ? <div key={i} className="mbar-sep" /> : (
        <div key={i} className="mbar-item-wrap" onMouseEnter={() => setSub(it.sub ? i : null)}>
          <button role="menuitem" className={`mbar-item ${it.sub ? 'has-sub' : ''}`} disabled={it.disabled} title={it.title} data-testid={it.testId}
            onClick={() => {
              if (it.sub) return setSub(sub === i ? null : i);
              menuCtl.set(null);
              it.onClick?.();
            }}>
            <span className="mi-check">{it.checked === undefined ? '' : it.checked ? '✓' : ''}</span>
            <span className="mi-label">{it.label}</span>
            <span className="mi-key">{it.sub ? '▸' : it.key ?? ''}</span>
          </button>
          {it.sub && sub === i && <MenuList items={it.sub} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function TopMenu({ id, label, title, items }: { id: string; label: string; title: string; items: MenuItem[] }) {
  const raw = useMenu();
  const [open, want] = (raw ?? '').split(':');
  return (
    <div className="mbar-menu">
      <button className={`mbar-top ${open === id ? 'on' : ''}`} data-menu={id} title={title}
        onClick={() => menuCtl.set(open === id ? null : id)} onMouseEnter={() => { if (open && open !== id) menuCtl.set(id); }}>{label}</button>
      {open === id && <MenuList items={items} depth={0} want={want} />}
    </div>
  );
}

/** The menu bar: File, Edit, View, Song, Tools, Help. */
export function MenuBar({ state, store, player, status }: { state: AppState; store: Store; player: ScorePlayer | null; status: PlayerStatus | null }) {
  const song = state.song;
  const L = state.layout;
  const open = useMenu();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.mbar')) menuCtl.set(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') menuCtl.set(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const bar = state.cursor?.bar ?? status?.range?.startBar ?? status?.currentBar ?? 0;
  const t = song?.tracks[state.selTrack];
  const file: MenuItem[] = [
    { label: 'Home', title: 'The start screen: open music, describe a song, start from chords, examples and recent files', testId: 'menu-home', onClick: () => store.showHome(true) },
    {
      label: 'New', title: 'Start a new song', testId: 'menu-new', sub: [
        { label: 'Guitar song (6 strings, tab + sheet music)', title: 'An empty song with one guitar track: use it to write a guitar part from scratch', onClick: () => { store.newSong('guitar'); store.setWorkspace('write'); } },
        { label: 'Bass song (4 strings, tab)', title: 'An empty song with one bass track: use it to write a bass line from scratch', onClick: () => { store.newSong('bass'); store.setWorkspace('write'); } },
        { label: 'Start from chords…', title: 'Type the chords (e.g. | C | Am | F | G |) and the band plays them: the quickest way to a backing track', testId: 'new-chart', onClick: () => store.openChart(true) },
        { label: 'Describe a song…', title: 'Say in words what you want ("a sad folk song in D, slow, with piano") and hear it', testId: 'new-describe', onClick: () => store.openDescribe(true) },
        { label: 'Song from a recording…', title: 'Start from an MP3/WAV: the Recordings workspace finds the beat and turns it into notes', onClick: () => { store.setWorkspace('rec'); void analysisCtl.current?.newFromRecording().catch((e) => store.showError((e as Error).message)); } },
      ],
    },
    { label: 'Open…', key: 'Ctrl+O', testId: 'menu-open', title: 'Open sheet music or a song file: MusicXML, Guitar Pro (3-7), MIDI, musicGenie projects, Rocksmith files', onClick: () => void store.openDialog() },
    {
      label: 'Open recent', title: 'Files you opened or saved lately', disabled: !state.recent.length,
      sub: state.recent.map((p) => ({ label: p.split(/[\\/]/).pop(), title: p, onClick: () => void store.openPath(p) })),
    },
    { label: 'Try an example', title: 'Free example songs to play with', sub: EXAMPLES.map((e) => ({ label: e.title, title: e.what, onClick: () => void openExample(store, e.id) })) },
    { sep: true },
    { label: 'Save', key: 'Ctrl+S', disabled: !song, title: 'Save the song as a musicGenie project (.mgproj) so you can come back to it', onClick: () => void store.save() },
    { label: 'Save as…', key: 'Ctrl+Shift+S', disabled: !song, title: 'Save under a new name or in another folder, e.g. to keep the old version', onClick: () => void store.save(true) },
    { label: 'Save as one file…', disabled: !song, title: 'One .mgpack file with the song and all its audio (package): use it to move a song to another PC or send it', onClick: () => void store.savePackage() },
    { sep: true },
    {
      label: 'Export', title: 'Make files other programs can use', disabled: !song, sub: [
        { label: 'Audio, MIDI, sheet music, PDF…', testId: 'export-open', title: 'Export the song as WAV/MP3 audio, each instrument separately, MIDI, MusicXML, Guitar Pro or a printable PDF', onClick: () => store.openExport(true) },
        { label: 'Rocksmith 2014…', testId: 'rs-open', title: 'Bonus: turn the guitar/bass parts into a Rocksmith 2014 custom song you can play in the game', onClick: () => store.openRsExport(true) },
      ],
    },
  ];
  const edit: MenuItem[] = [
    { label: `Undo${state.undoLabel ? ' ' + state.undoLabel : ''}`, key: 'Ctrl+Z', disabled: !state.canUndo, testId: 'menu-undo', title: 'Take back the last change', onClick: () => store.undo() },
    { label: `Redo${state.redoLabel ? ' ' + state.redoLabel : ''}`, key: 'Ctrl+Y', disabled: !state.canRedo, testId: 'menu-redo', title: 'Put back the change you just undid', onClick: () => store.redo() },
    { sep: true },
    { label: '✎ Write notes', checked: state.editMode, disabled: !song, title: 'Note editing: click a beat in the score, then type frets (tab) or letters A-G (sheet music)', onClick: () => { store.setEditMode(!state.editMode); if (!state.editMode) store.setWorkspace('write'); } },
    { label: '⌨ Keyboard piano', checked: state.kbdPiano, disabled: !song, title: 'Play notes with the computer keyboard (A S D F… = white keys) when you have no MIDI keyboard', onClick: () => store.setKbdPiano(!state.kbdPiano) },
  ];
  const zoom = (f: number | 'fit' | 1) => store.setLayout({ zoom: f === 'fit' ? 'fit' : f });
  const curScale = player?.scale ?? 1;
  const view: MenuItem[] = [
    { label: 'Full score', key: 'F11', checked: state.fullScore, disabled: !song, testId: 'menu-fullscore', title: 'Only the music and a slim play bar, nothing else: for reading and playing along (Esc returns)', onClick: () => store.setFullScore(!state.fullScore) },
    { sep: true },
    { label: 'Zoom in', key: 'Ctrl++', disabled: !song, title: 'Make the music bigger (also Ctrl + mouse wheel)', onClick: () => zoom(curScale * 1.15) },
    { label: 'Zoom out', key: 'Ctrl+-', disabled: !song, title: 'Make the music smaller to see more bars at once', onClick: () => zoom(curScale / 1.15) },
    { label: 'Fit to width', key: 'Ctrl+0', checked: L.zoom === 'fit', title: 'Size the music to the window width automatically (the default)', onClick: () => zoom('fit') },
    { label: 'Actual size (100 %)', title: 'Show the music at its normal printed size', onClick: () => zoom(1) },
    { sep: true },
    { label: 'Page view', checked: L.view === 'page', title: 'Lines of music one under the other, like printed sheet music', onClick: () => store.setLayout({ view: 'page' }) },
    { label: 'Scrolling view', checked: L.view === 'scroll', title: 'All bars in one long line that scrolls sideways as it plays', onClick: () => store.setLayout({ view: 'scroll' }) },
    { sep: true },
    { label: 'Tracks panel', checked: L.leftOpen, title: 'Show or hide the list of tracks (instruments) on the left', onClick: () => store.setLayout({ leftOpen: !L.leftOpen }) },
    { label: 'Band panel', checked: L.rightOpen, title: 'Show or hide the band panel on the right (Arrange): chords, sections, style, Generate', onClick: () => { store.setLayout({ rightOpen: !L.rightOpen }); store.setWorkspace('arrange'); } },
    { label: 'Reset the layout', title: 'Put all panels back to their starting sizes (if you dragged something too small or too big)', onClick: () => store.resetLayout() },
    { sep: true },
    ...WORKSPACES.map((w, i) => ({ label: w.label, key: `Ctrl+${i + 1}`, checked: state.workspace === w.id, title: w.title, onClick: () => store.setWorkspace(w.id) })),
  ];
  const songMenu: MenuItem[] = [
    { label: 'Key, time & tempo changes…', disabled: !song, testId: 'open-changes', title: 'Change the key, the beats per bar or the speed from a bar on, e.g. a faster chorus or a key change', onClick: () => store.openChanges(bar) },
    { label: 'Edit chord chart…', disabled: !song?.chart, title: 'Change the chords of a song you started from chords; the band follows', onClick: () => store.openChart(true, true) },
    { sep: true },
    { label: 'Transpose song up (half step)', disabled: !song, title: 'Move every note one half step (semitone) higher, e.g. to suit a singer', onClick: () => store.transpose(1) },
    { label: 'Transpose song down (half step)', disabled: !song, title: 'Move every note one half step (semitone) lower, e.g. to suit a singer', onClick: () => store.transpose(-1) },
    { sep: true },
    { label: 'Band…', disabled: !song, title: 'Open the band panel: pick a style and let the virtual band play your chords', onClick: () => { store.setWorkspace('arrange'); store.setLayout({ rightOpen: true }); } },
    {
      label: `Split “${t?.name ?? 'track'}” into melody / bass / harmony`, disabled: !t || !!t.instrument.percussion || !!t.generated || !!t.audio,
      title: 'Make separate band parts (melody, harmony, bass) from the selected track, e.g. a piano piece for a band. The original is kept, muted.',
      onClick: () => t && store.splitTrack(t.id),
    },
  ];
  const tools: MenuItem[] = [
    { label: 'Describe a song…', title: 'Say in words what you want and hear it played', onClick: () => store.openDescribe(true) },
    { label: 'Start from chords…', title: 'Type chords and the band plays them', onClick: () => store.openChart(true) },
    { label: 'Recording to sheet music', title: 'Turn an MP3/WAV recording into notes step by step (Recordings workspace)', onClick: () => store.openDock('rec') },
    { label: 'Read sheet music from a PDF or photo…', title: 'Turn a scan or photo of printed music into a song you can play and edit (Audiveris)', onClick: () => void omrCtl.importScore(store).catch((e) => store.showError((e as Error).message)) },
    { label: 'Compare with the recording', disabled: !song, title: 'Show the recording under the notes to check and fix them (review view)', onClick: () => { store.openDock('rec'); reviewCtl.set({ on: true }); } },
    { sep: true },
    { label: 'Mixer', disabled: !song, title: 'Volume, left/right and effects per instrument', onClick: () => store.openDock('mixer') },
    { label: 'Sound library', disabled: !song, title: 'Add better instrument sounds and choose a sound per track', onClick: () => store.openDock('sounds') },
    { label: 'Load a sound set (SoundFont)…', title: 'Play every instrument with a .sf2/.sf3 sound set you downloaded, e.g. for more realistic sounds', onClick: () => void store.chooseSoundFont() },
    { label: 'Use the built-in sound set', disabled: !state.soundFontPath, title: `Go back to the sounds that come with the app (${DEFAULT_SOUNDFONT})`, onClick: () => void store.useDefaultSoundFont() },
  ];
  const help: MenuItem[] = [
    { label: 'Take the tour', testId: 'menu-tour', title: 'A short guided walk through the main path: open, see, change an instrument, add a band, play', onClick: () => tourCtl.start('first', store) },
    { label: 'More tours', title: 'Short guided tours for the other things you can do', sub: TOURS.filter((x) => x.id !== 'first').map((x) => ({ label: x.title, title: x.what, testId: 'tour-' + x.id, onClick: () => tourCtl.start(x.id, store) })) },
    { sep: true },
    { label: 'Help topics…', key: 'F1', testId: 'menu-help', title: 'Search the help: what each part of the app is for, when to use it, with examples', onClick: () => helpCtl.open('') },
    { label: 'Glossary', title: 'Music and app words explained (bar, track, tab, transpose, chord symbol…)', onClick: () => helpCtl.open('glossary') },
    { label: 'About musicGenie', title: 'Version and credits', onClick: () => helpCtl.open('about') },
  ];
  return (
    <nav className="mbar">
      <TopMenu id="file" label="File" title="Open, save, new songs, examples, export" items={file} />
      <TopMenu id="edit" label="Edit" title="Undo, redo, note editing" items={edit} />
      <TopMenu id="view" label="View" title="Full score, zoom, page or scrolling view, panels, workspaces" items={view} />
      <TopMenu id="song" label="Song" title="Key, time and tempo, transpose, band, split parts" items={songMenu} />
      <TopMenu id="tools" label="Tools" title="Describe a song, chords, recordings, sheet music from PDF, mixer, sounds" items={tools} />
      <TopMenu id="help" label="Help" title="Tours, help topics, glossary" items={help} />
    </nav>
  );
}

// ---------------------------------------------------------------- workspace tabs
export function WorkspaceTabs({ state, store }: { state: AppState; store: Store }) {
  return (
    <div className="ws-tabs" role="tablist">
      {WORKSPACES.map((w) => (
        <button key={w.id} role="tab" className={`ws-tab ${state.workspace === w.id && !state.home ? 'on' : ''}`} data-ws={w.id} data-testid={'ws-' + w.id}
          title={w.title} onClick={() => store.setWorkspace(w.id)}>{w.label}</button>
      ))}
    </div>
  );
}

/** Small tools that belong to the current workspace, next to the tabs. */
export function WorkspaceTools({ state, store, status }: { state: AppState; store: Store; status: PlayerStatus | null }) {
  const song = state.song;
  if (!song || state.home) return null;
  const ws: Workspace = state.workspace;
  return (
    <div className="ws-tools">
      {ws === 'arrange' && (
        <span className="group" title="Move every note of the song up or down by half steps (transpose), e.g. to suit a singer">
          <span className="lbl">Transpose song</span>
          <button onClick={() => store.transpose(-1)} title="Transpose the whole song down a half step (semitone)">−</button>
          <span className="val" data-testid="transpose-total">{state.transposeTotal > 0 ? '+' : ''}{state.transposeTotal}</span>
          <button onClick={() => store.transpose(1)} title="Transpose the whole song up a half step (semitone)">+</button>
        </span>
      )}
      {ws === 'write' && (
        <>
          <button className={state.editMode ? 'chip' : ''} data-testid="edit-toggle"
            title="Write notes: click a beat in the score, then type frets (tab) or letters A-G (sheet music). Esc stops." onClick={() => store.setEditMode(!state.editMode)}>✎ Write notes</button>
          <KbdPianoToggle state={state} store={store} />
        </>
      )}
      {ws === 'mix' && (
        <>
          <SettingsMenu state={state} store={store} soundFont={status?.soundFont ?? DEFAULT_SOUNDFONT} />
          <button onClick={() => store.openExport(true)} data-testid="mix-export" title="Export the finished mix as WAV/MP3 (or each instrument separately, MIDI, PDF…)">⇩ Export…</button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- play bar
const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PlayBar({ state, store, player, status }: { state: AppState; store: Store; player: ScorePlayer | null; status: PlayerStatus | null }) {
  const song = state.song;
  const p = state.practice;
  const pts = useMemo(() => (song ? tempoPoints(song) : null), [song]);
  const endMs = useMemo(() => (song && pts ? msAtTick(pts, songEndTick(song)) : 0), [song, pts]);
  const nowMs = pts && status ? msAtTick(pts, status.songTick) : 0;
  const ready = !!song && !!status?.ready;
  const bpm = song ? (pts && status ? song.tempos.filter((t) => t.bar <= status.currentBar).pop()?.bpm ?? song.tempos[0]?.bpm : song.tempos[0]?.bpm) : null;
  const scalePct = Math.round((player?.scale ?? 1) * 100);
  const L = state.layout;
  return (
    <div className={`playbar ${state.fullScore ? 'slim' : ''}`} data-testid="playbar">
      <button className="primary play" disabled={!ready} onClick={() => player?.playPause()} data-testid="play" data-tour="play"
        title="Play or pause the song from the cursor (Space). Click a bar in the score first to start there.">{status?.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button disabled={!ready} onClick={() => player?.stop()} data-testid="stop" title="Stop and go back to the start (or the start of the selected bars)">■ Stop</button>
      <span className="pos" title="Where the song is: bar number and time" data-testid="bar-indicator">
        {song && status ? `Bar ${status.currentBar + 1} / ${song.bars.length}` : 'Bar –'} <span className="lbl">· {fmt(nowMs)} / {fmt(endMs)}</span>
      </span>
      <button className="tempo" disabled={!song} data-testid="playbar-tempo" onClick={() => store.openChanges(status?.currentBar ?? 0)}
        title="The song's speed in beats per minute (tempo). Click to change it from this bar on. For practice, use Speed instead.">♩ = {bpm ? Math.round(bpm) : '–'}</button>
      <label className={`toggle ${p.loop ? 'on' : ''}`} title="Loop: play the selected bars over and over (drag over bars in the score to select them), e.g. to practise a hard part">
        <input type="checkbox" checked={p.loop} onChange={(e) => store.setPractice({ loop: e.target.checked })} /> Loop
      </label>
      {status?.range && (
        <button className="chip" onClick={() => player?.clearRange()} title="Clear the bar selection (play the whole song again)">
          bars {status.range.startBar + 1}–{status.range.endBar + 1} ✕
        </button>
      )}
      <label className={`toggle ${p.metronome ? 'on' : ''}`} title="Metronome: a click on every beat while playing, to help you keep time">
        <input type="checkbox" checked={p.metronome} onChange={(e) => store.setPractice({ metronome: e.target.checked })} /> Metronome
      </label>
      <label className={`toggle ${p.countIn ? 'on' : ''}`} title="Count-in: one bar of clicks before the music starts, so you can get ready to play along">
        <input type="checkbox" checked={p.countIn} onChange={(e) => store.setPractice({ countIn: e.target.checked })} /> Count-in (clicks before playing)
      </label>
      <label className="speed" title="Practice speed: slow the song down (or speed it up) without changing the song itself">
        Speed
        <input type="range" min={25} max={150} step={5} value={p.speed} onChange={(e) => store.setPractice({ speed: Number(e.target.value) })} />
        <span className="val">{p.speed}%</span>
      </label>
      <label className="speed" title="Volume of the whole song (the same as the Master fader in the Mixer)">
        🔊
        <input type="range" min={0} max={1} step={0.01} disabled={!song} value={song?.mix?.master.volume ?? 0.8} data-testid="playbar-volume"
          onChange={(e) => store.setSongMix((m) => ({ ...m, master: { ...m.master, volume: Number(e.target.value) } }), 'Master volume', 'master-vol')} />
      </label>
      <span className="spacer" />
      <span className="group zoom" title="Size of the music on screen (Ctrl + mouse wheel works too)">
        <button disabled={!song} onClick={() => store.setLayout({ zoom: (player?.scale ?? 1) / 1.15 })} data-testid="zoom-out" title="Zoom out: smaller music, more bars on screen (Ctrl+-)">−</button>
        <button disabled={!song} className={L.zoom === 'fit' ? 'chip' : ''} onClick={() => store.setLayout({ zoom: 'fit' })} data-testid="zoom-fit"
          title="Fit to width: size the music to the window automatically (Ctrl+0)">{L.zoom === 'fit' ? 'Fit' : scalePct + '%'}</button>
        <button disabled={!song} onClick={() => store.setLayout({ zoom: (player?.scale ?? 1) * 1.15 })} data-testid="zoom-in" data-tour="zoom-in" title="Zoom in: bigger music (Ctrl++)">+</button>
      </span>
      <button disabled={!song} onClick={() => store.setLayout({ view: L.view === 'page' ? 'scroll' : 'page' })} data-testid="view-mode"
        title={L.view === 'page' ? 'Page view (lines one under the other, like printed music). Click for Scrolling view: one long line that scrolls sideways.' : 'Scrolling view (one long line). Click for Page view: lines one under the other, like printed music.'}>
        {L.view === 'page' ? '▤ Page' : '⇆ Scrolling'}
      </button>
      <button disabled={!song} className={state.fullScore ? 'chip' : ''} onClick={() => store.setFullScore(!state.fullScore)} data-testid="fullscore" data-tour="fullscore"
        title={state.fullScore ? 'Back to the normal layout (Esc)' : 'Full score: only the music and this bar, for reading and playing along (F11; Esc returns)'}>
        {state.fullScore ? '✕ Exit full score' : '⛶ Full score'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- home
export function Home({ state, store }: { state: AppState; store: Store }) {
  const [examples, setExamples] = useState(false);
  const cards: { id: string; icon: string; title: string; what: string; go: () => void; extra?: React.ReactNode }[] = [
    { id: 'open', icon: '📂', title: 'Open sheet music or a MIDI/Guitar Pro file', what: 'See it as sheet music or tabs and hear it played (MusicXML, MIDI, Guitar Pro, musicGenie projects).', go: () => void store.openDialog() },
    { id: 'describe', icon: '💬', title: 'Describe a song and hear it', what: 'Type what you want, e.g. "slow sad folk song in D with piano"; you get chords and a band.', go: () => store.openDescribe(true) },
    { id: 'chords', icon: '🎼', title: 'Start from chords', what: 'Type chords like | C | Am | F | G | and pick a style: the band plays them.', go: () => store.openChart(true) },
    {
      id: 'write', icon: '✎', title: 'Write from scratch', what: 'An empty song: enter notes on the score or in the piano roll.', go: () => { store.newSong('guitar'); store.setWorkspace('write'); },
      extra: (
        <span className="hc-sub">
          <button onClick={(e) => { e.stopPropagation(); store.newSong('guitar'); store.setWorkspace('write'); }} title="An empty song with one guitar track (tab + sheet music)">Guitar</button>
          <button onClick={(e) => { e.stopPropagation(); store.newSong('bass'); store.setWorkspace('write'); }} title="An empty song with one bass track (tab)">Bass</button>
        </span>
      ),
    },
    { id: 'recording', icon: '🎧', title: 'Turn a recording into sheet music', what: 'Load an MP3/WAV: find the beat, split the instruments, turn them into notes you can edit.', go: () => store.openDock('rec') },
    {
      id: 'examples', icon: '★', title: 'Try an example', what: 'Free songs to play with: classical, folk and a blues.', go: () => setExamples(!examples),
      extra: examples || state.home || !state.song ? (
        <span className="hc-sub col" data-tour="home-examples">
          {EXAMPLES.map((e) => (
            <button key={e.id} data-example={e.id} onClick={(ev) => { ev.stopPropagation(); void openExample(store, e.id); }} title={e.what}>{e.title}</button>
          ))}
        </span>
      ) : null,
    },
  ];
  return (
    <div className="home" data-testid="home">
      <div className="home-in">
        <div className="home-head">
          <h1>What would you like to do?</h1>
          <HelpButton topic="home" label="start screen" />
          {state.song && <button className="close" onClick={() => store.showHome(false)} title="Back to the open song" data-testid="home-close">Back to “{state.song.title}”</button>}
        </div>
        <div className="home-cards">
          {cards.map((c) => (
            <div key={c.id} className="home-card" role="button" tabIndex={0} data-card={c.id} data-testid={'home-' + c.id} title={c.what}
              onClick={c.go} onKeyDown={(e) => { if (e.key === 'Enter') c.go(); }}>
              <span className="hc-icon">{c.icon}</span>
              <span className="hc-title">{c.title}</span>
              <span className="hc-what">{c.what}</span>
              {c.extra}
            </div>
          ))}
        </div>
        <div className="home-recent">
          <h3>Recent files</h3>
          {state.recent.length ? state.recent.map((p) => (
            <button key={p} className="recent" onClick={() => void store.openPath(p)} title={'Open ' + p}>
              <b>{p.split(/[\\/]/).pop()}</b> <span className="lbl">{p.replace(/[\\/][^\\/]*$/, '')}</span>
            </button>
          )) : <div className="lbl">Nothing yet: files you open or save show up here.</div>}
        </div>
        <div className="home-foot lbl">
          New here? <button onClick={() => tourCtl.start('first', store)} title="A short guided walk through the main path" data-testid="home-tour">Take the tour</button> or press F1 for help.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- help viewer
export function HelpDialog() {
  const topic = useHelpTopic();
  const [q, setQ] = useState('');
  useEffect(() => { if (topic === '') setQ(''); }, [topic]);
  if (topic === null) return null;
  const close = () => helpCtl.open(null);
  const t = HELP_TOPICS.find((x) => x.id === topic);
  const ql = q.trim().toLowerCase();
  const hits = HELP_TOPICS.filter((x) => !ql || (x.title + ' ' + x.what + ' ' + x.when + ' ' + x.steps.join(' ') + ' ' + (x.tips ?? []).join(' ')).toLowerCase().includes(ql));
  const gloss = GLOSSARY.filter((g) => !ql || (g.term + ' ' + g.meaning).toLowerCase().includes(ql));
  const areas = [...new Set(hits.map((h) => h.area))];
  return (
    <div className="modal-back" data-testid="help" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal help-modal">
        <div className="help-head">
          {topic !== '' && <button onClick={() => helpCtl.open('')} title="Back to the list of help topics">← All topics</button>}
          <b>{t ? t.title : topic === 'glossary' ? 'Glossary' : topic === 'about' ? 'About musicGenie' : 'Help topics'}</b>
          <button className="close" onClick={close} title="Close the help (Esc)">✕</button>
        </div>
        {t && (
          <div className="help-page" data-testid="help-page" data-topic={t.id}>
            <p>{t.what}</p>
            <h4>When to use it</h4>
            <p>{t.when}</p>
            <h4>Try it</h4>
            <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {!!t.tips?.length && (<><h4>Tips</h4><ul>{t.tips.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
          </div>
        )}
        {topic === 'about' && (
          <div className="help-page">
            <p>musicGenie: open or write music, see it as sheet music or tabs, give it instruments and a band, and hear it.</p>
            <p className="lbl">Sounds: GeneralUser GS by S. Christian Collins. Notation: alphaTab. Example songs are public domain. Rocksmith 2014 export is a bonus.</p>
          </div>
        )}
        {(topic === '' || topic === 'glossary') && (
          <>
            <input className="help-search" autoFocus placeholder="Search help, e.g. “tempo”, “guitar”, “export”" value={q} onChange={(e) => setQ(e.target.value)}
              title="Type a word to find help pages and glossary entries" data-testid="help-search" />
            <div className="help-list">
              {topic === '' && areas.map((a) => (
                <div key={a} className="help-area">
                  <h4>{a}</h4>
                  {hits.filter((h) => h.area === a).map((h) => (
                    <button key={h.id} className="help-link" onClick={() => helpCtl.open(h.id)} title={h.what} data-topic={h.id}>{h.title}</button>
                  ))}
                </div>
              ))}
              <div className="help-area glossary" data-testid="glossary">
                <h4>Glossary</h4>
                <dl>{gloss.map((g) => <div key={g.term}><dt>{g.term}</dt><dd>{g.meaning}</dd></div>)}</dl>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tour overlay
export function TourOverlay({ state, store }: { state: AppState; store: Store }) {
  const tour = useTour();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const step = tour ? TOURS.find((t) => t.id === tour.id)?.steps[tour.step] : undefined;
  useEffect(() => {
    if (!tour || !step) return;
    const tick = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      setRect(el ? el.getBoundingClientRect() : null);
      // A step moves on by itself only when the user does the thing (not if it was already so when shown).
      const k = 'already' + tour.step;
      const isDone = !!step.done?.(store, playerCtl.current?.status ?? null, tour.memo);
      if (tourCtl.prepared && tour.memo[k] === undefined) tour.memo[k] = isDone;
      else if (isDone && tour.memo[k] === false) tourCtl.next(store);
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [tour?.id, tour?.step, state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tour || !step) return null;
  const def = TOURS.find((t) => t.id === tour.id)!;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const bw = 340;
  let left = rect ? Math.min(W - bw - 12, Math.max(12, rect.left)) : W / 2 - bw / 2;
  let top = rect ? (rect.bottom + 12 + 190 < H ? rect.bottom + 12 : Math.max(12, rect.top - 12 - 190)) : H / 3;
  if (rect && rect.height > H * 0.5) { top = Math.max(12, rect.top + 24); left = Math.max(12, Math.min(W - bw - 12, rect.left + 24)); }
  return (
    <div className="tour" data-testid="tour" data-tour-id={tour.id} data-step={tour.step}>
      {rect && <div className="tour-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div className="tour-bubble" ref={bubble} style={{ left, top, width: bw }}>
        <div className="tour-count">{def.title} · step {tour.step + 1} of {def.steps.length}</div>
        <div className="tour-title">{step.title}</div>
        <div className="tour-text">{step.text}</div>
        {step.done && tour.memo['already' + tour.step] === false && <div className="tour-hint">{step.hint ?? 'Do this in the app (the highlighted part) to go on, or press Next.'}</div>}
        <div className="rowx right">
          <button onClick={() => tourCtl.stop(store, false)} data-testid="tour-skip" title="End the tour now (you can take it again from Help > Take the tour)">Skip tour</button>
          {tour.step > 0 && <button onClick={() => tourCtl.back(store)} title="Go back one step">Back</button>}
          <button className="primary" onClick={() => tourCtl.next(store)} data-testid="tour-next" title="Go to the next step">{tour.step + 1 === def.steps.length ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
