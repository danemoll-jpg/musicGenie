// Round 8: the bottom panel of the Write / Mix / Recordings workspaces (each shows only its own tabs),
// and the drag handles that resize the side panels and the bottom panel.
import { useRef } from 'react';
import { ChordExplorer } from './ChordExplorer';
import { DrumGrid } from './DrumGrid';
import { PianoRoll } from './PianoRoll';
import { Progressions } from './Progressions';
import { MixerView } from './Mixer';
import { AutomationPanel } from './Automation';
import { AudioPanel } from './AudioTracks';
import { RecordingPanel } from './Round6';
import { LyricsPanel, SoundLibrary } from './Round7';
import { MidiPanel } from './Round4';
import { HelpButton } from './HelpUi';
import type { MidiController } from './midi';
import type { PlayerStatus } from './player';
import { WORKSPACES, type AppState, type DockTab, type Store } from './store';

export const DOCK_TABS: Record<DockTab, { label: string; title: string; help: string }> = {
  roll: { label: '🎹 Piano roll', help: 'piano-roll', title: 'Piano roll: draw, move and stretch notes as bars on a keyboard grid. Easiest way to write notes if you don\'t read music.' },
  drums: { label: '🥁 Drum grid', help: 'drum-grid', title: 'Drum grid: click squares to make a drum beat (kick, snare, hi-hat…). Use it to write or change drum parts.' },
  chords: { label: '♯ Chords', help: 'chord-explorer', title: 'Chords: every way to play a chord on guitar or piano; hear it and put it in the song' },
  prog: { label: '⇢ What chord next', help: 'progressions', title: 'Chord progressions: suggestions for what chord could come next, swaps that still fit, and well-known chord patterns' },
  lyrics: { label: '🎤 Lyrics & singing', help: 'lyrics', title: 'Lyrics: type or paste words under the notes (verses, syllables), and have a voice sing them' },
  midi: { label: '🎛 MIDI keyboard', help: 'midi-keyboard', title: 'Play notes on a MIDI keyboard or the computer keyboard: hear them, enter them one by one, or record what you play' },
  mixer: { label: '🎚 Mixer', help: 'mixer', title: 'Mixer: how loud each instrument is, left/right, effects (reverb, echo, EQ…) and the master volume' },
  auto: { label: '〰 Changes over time', help: 'changes-over-time', title: 'Changes over time (automation): make volume, left/right or an effect change during the song, e.g. a fade-out' },
  audio: { label: '🎙 Audio tracks', help: 'audio-tracks', title: 'Audio tracks: add or record real audio (voice, guitar, a backing track), then move, trim and fade it' },
  sounds: { label: '🎻 Sounds', help: 'sound-library', title: 'Sound library: add better instrument sounds (SoundFont / SFZ files) and pick a sound per track' },
  rec: { label: '🎧 Recording to sheet music', help: 'recording-to-sheet-music', title: 'Turn a recording into notes step by step (beat, instruments, notes), or read sheet music from a PDF/photo' },
};

/** Drag handle: reports the drag distance (px) from where it started. */
export function Splitter({ dir, onDrag, title, testId }: { dir: 'col' | 'row'; onDrag: (delta: number, start: boolean) => void; title: string; testId?: string }) {
  const start = useRef(0);
  return (
    <div className={`splitter ${dir}`} title={title} data-testid={testId}
      onPointerDown={(e) => {
        start.current = dir === 'col' ? e.clientX : e.clientY;
        onDrag(0, true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        onDrag((dir === 'col' ? e.clientX : e.clientY) - start.current, false);
      }} />
  );
}

export function Dock({ state, store, status, midi }: { state: AppState; store: Store; status: PlayerStatus | null; midi: MidiController }) {
  const song = state.song;
  const ws = WORKSPACES.find((w) => w.id === state.workspace)!;
  const startH = useRef(0);
  if (!ws.tabs.length || state.fullScore) return null;
  // Without a song only the recording tools work (they start a song from a recording).
  const tabs = song ? ws.tabs : ws.tabs.filter((t) => t === 'rec');
  if (!tabs.length) return null;
  const open = state.dock && tabs.includes(state.dock) ? state.dock : null;
  const tall = open === 'mixer' || open === 'audio' || open === 'rec' || open === 'lyrics' || open === 'sounds';
  const h = state.layout.dockH;
  const ti = song ? Math.min(state.selTrack, song.tracks.length - 1) : 0;
  return (
    <>
      {open && (
        <Splitter dir="row" title="Drag to make the bottom panel taller or shorter" testId="dock-splitter"
          onDrag={(d, s) => { if (s) startH.current = h; else store.setLayout({ dockH: Math.max(140, Math.min(window.innerHeight - 220, startH.current - d)) }); }} />
      )}
      <div className={`dock ${open ? '' : 'folded'} ${tall ? 'tall' : ''}`} data-testid="dock" style={open ? { height: h } : undefined}>
        <div className="dock-tabs">
          {tabs.map((t) => (
            <button key={t} className={open === t ? 'chip' : ''} title={DOCK_TABS[t].title} onClick={() => store.openDock(open === t ? null : t)} data-testid={'dock-' + t}>{DOCK_TABS[t].label}</button>
          ))}
          {open && <HelpButton topic={DOCK_TABS[open].help} />}
          {song && open && open !== 'rec' && open !== 'mixer' && open !== 'sounds' && (
            <label className="dock-track" title="Which track (instrument) this panel works on. You can also click a track on the left.">
              <span className="lbl">Track</span>
              <select value={ti} onChange={(e) => store.setSelTrack(Number(e.target.value))} data-testid="dock-track">
                {song.tracks.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
              </select>
            </label>
          )}
          <button className="close" onClick={() => store.openDock(open ? null : tabs[0])} data-testid="dock-fold"
            title={open ? 'Fold the bottom panel away to give the music more room (click a tab to open it again)' : 'Open the bottom panel'}>{open ? '▾ Hide' : '▴ Show'}</button>
        </div>
        {open && (
          <div className="dock-body">
            {open === 'roll' && song && song.tracks.length > 0 && <PianoRoll state={state} store={store} status={status} />}
            {open === 'drums' && song && <DrumGrid state={state} store={store} status={status} />}
            {open === 'chords' && song && song.tracks.length > 0 && <ChordExplorer state={state} store={store} currentBar={status?.currentBar ?? 0} />}
            {open === 'prog' && song && <Progressions state={state} store={store} status={status} />}
            {open === 'midi' && song && <MidiPanel state={state} store={store} midi={midi} />}
            {open === 'mixer' && song && <MixerView state={state} store={store} />}
            {open === 'auto' && song && song.tracks.length > 0 && <AutomationPanel state={state} store={store} status={status} />}
            {open === 'audio' && song && <AudioPanel state={state} store={store} status={status} />}
            {open === 'rec' && <RecordingPanel state={state} store={store} status={status} />}
            {open === 'lyrics' && song && song.tracks.length > 0 && <LyricsPanel state={state} store={store} status={status} />}
            {open === 'sounds' && song && <SoundLibrary state={state} store={store} />}
          </div>
        )}
      </div>
    </>
  );
}
