import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hashOf, librarySoundFiles, INSTRUMENT_GROUPS, INSTRUMENTS, STYLES, type DisplayMode, type Track } from '../../model';
import { BackingPlayer } from './audio/backing';
import { BandPanel } from './BandPanel';
import { editorKey } from './editor';
import { ChordPickerPopover, ConfirmDialog } from './Overlays';
import { DEFAULT_SOUNDFONT, ScorePlayer, type PlayerStatus } from './player';
import { BackingRow, CursorOverlay, EditBar, RocksmithDialog, TuningControls, TuningDialog } from './Round3';
import { ChangesDialog, ChartDialog, HarmonyMenu } from './Round4';
import { Dock, Splitter } from './Workspace';
import { HelpButton, helpCtl } from './HelpUi';
import { Home, HelpDialog, MenuBar, PlayBar, TourOverlay, WorkspaceTabs, WorkspaceTools, menuCtl, openExample } from './Shell';
import { tourCtl, tourHooks } from './tours';
import { WORKSPACES } from './store';
import { ExportDialog } from './Round5';
import { JobBar } from './Round6';
import { ReviewView } from './Review';
import { DescribeDialog } from './Round7';
import { liveSynth } from './audio/liveSynth';
import { songExtras } from './soundLib';
import type { MidiController } from './midi';
import type { AppState, Store } from './store';

function useStore(store: Store): AppState {
  return useSyncExternalStore((f) => store.on(f), () => store.state);
}

export function App({ store, onPlayer, midi }: { store: Store; onPlayer: (p: ScorePlayer, b: BackingPlayer) => void; midi: MidiController }) {
  const state = useStore(store);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<ScorePlayer | null>(null);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const loadedSoundFont = useRef<string | null>('#');
  const backingRef = useRef<BackingPlayer | null>(null);

  useEffect(() => {
    const p = new ScorePlayer(hostRef.current!, scrollRef.current!);
    const b = new BackingPlayer(p);
    backingRef.current = b;
    p.onBeatClick = (hit) => store.setCursor({ ...hit, string: hit.string ?? store.state.cursor?.string ?? 1 });
    setPlayer(p);
    onPlayer(p, b);
    const off = p.on(setStatus);
    return () => {
      off();
      p.api.destroy();
    };
  }, []);

  useEffect(() => {
    if (player && state.song) player.show(state.song, state.loadId);
    void backingRef.current?.setSong(state.song);
  }, [player, state.song, state.loadId]);

  useEffect(() => {
    if (player) player.editMode = state.editMode;
  }, [player, state.editMode]);

  // SoundFont: load the user's file when chosen, the built-in one when cleared.
  // Round 7: plus the sound-library files the song's tracks use (banks moved, appended).
  const extrasKey = state.song ? librarySoundFiles(state.song).join('|') : '';
  useEffect(() => {
    if (!player) return;
    const want = state.soundFontPath;
    const key = (want ?? '') + '#' + extrasKey;
    if (key === loadedSoundFont.current) return;
    loadedSoundFont.current = key;
    void (async () => {
      try {
        const main = want ? await window.mg.readFile(want) : null;
        const mainBytes = async () => main?.bytes ?? (await player.defaultSoundFontBytes());
        const { extras, missing } = extrasKey && store.state.song ? await songExtras(store.state.song, mainBytes) : { extras: [], missing: [] };
        if (missing.length) store.showError('Sound library file not found (those tracks use the main SoundFont): ' + missing.join(', '));
        const bytes = main ? main.bytes : extras.length ? await mainBytes() : null;
        player.setSoundFont(bytes, main?.name ?? DEFAULT_SOUNDFONT, extras);
        liveSynth.setSoundFont(bytes, main?.name ?? DEFAULT_SOUNDFONT);
        liveSynth.setExtras(extras);
      } catch (e) {
        store.showError('Could not load the SoundFont: ' + (e as Error).message);
      }
    })();
  }, [player, state.soundFontPath, extrasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click a chord symbol in the score -> chord picker.
  useEffect(() => {
    const host = hostRef.current;
    const scroll = scrollRef.current;
    if (!host || !scroll || !player) return;
    const onClick = (e: MouseEvent) => {
      const song = store.state.song;
      const text = (e.target as Element)?.closest?.('text');
      const label = text?.textContent?.trim();
      if (!song || !label) return;
      const r = host.getBoundingClientRect();
      const bar = player.barAtPoint(e.clientX - r.left, e.clientY - r.top);
      const chord = song.chordSymbols.find((c) => c.bar === bar && c.name === label);
      if (!chord) return;
      const sr = scroll.getBoundingClientRect();
      store.openChordPicker({
        bar: chord.bar, tick: chord.tick, name: chord.name,
        x: e.clientX - sr.left + scroll.scrollLeft, y: e.clientY - sr.top + scroll.scrollTop + 14,
      });
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, [player]);

  useEffect(() => {
    if (!player) return;
    player.setSpeed(state.practice.speed);
    backingRef.current?.setSpeed(state.practice.speed);
    player.setMetronome(state.practice.metronome);
    player.setCountIn(state.practice.countIn);
    player.setLooping(state.practice.loop);
  }, [player, state.practice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'F11') { e.preventDefault(); if (store.state.song) store.setFullScore(!store.state.fullScore); return; }
      if (e.key === 'F1') { e.preventDefault(); helpCtl.open(''); return; }
      if (!typing && e.key !== ' ' && editorKey(store, player, e)) { e.preventDefault(); return; }
      if (e.key === 'Escape' && store.state.fullScore) { e.preventDefault(); store.setFullScore(false); return; }
      if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const cur = player?.scale ?? 1;
        store.setLayout({ zoom: e.key === '0' ? 'fit' : e.key === '-' ? cur / 1.15 : cur * 1.15 });
        return;
      }
      if (e.ctrlKey && !e.shiftKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); store.setWorkspace(WORKSPACES[Number(e.key) - 1].id); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); store.redo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void store.save(e.shiftKey); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); void store.openDialog(); }
      else if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT') { e.preventDefault(); player?.playPause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  // Round 8: view mode + zoom ('fit' follows the score width), Ctrl+wheel zoom.
  useEffect(() => { player?.setViewMode(state.layout.view); }, [player, state.layout.view]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!player || !el) return;
    const apply = () => {
      const z = store.state.layout.zoom;
      player.setScale(z === 'fit' ? Math.max(0.7, Math.min(2.2, (el.clientWidth - 40) / 1050)) : z);
    };
    apply();
    const ro = new ResizeObserver(() => { if (store.state.layout.zoom === 'fit') apply(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [player, state.layout.zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !player) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      store.setLayout({ zoom: player.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps
  // Round 8: recent files; the first-run tour (never in a hidden test window unless --tour).
  useEffect(() => {
    tourHooks.openExample = openExample;
    tourHooks.openMenu = (id) => menuCtl.set(id);
    void store.loadRecent();
    void window.mg.settingsGet().then((st) => {
      if (!st.tourDone && (!window.mg.flags.hidden || window.mg.flags.tour)) setTimeout(() => { if (!store.state.recovery) tourCtl.start('first', store); }, 600);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const song = state.song;
  const L = state.layout;
  const full = state.fullScore && !!song;
  const showHome = !song || state.home;
  const startW = useRef(0);
  return (
    <div className={`app ${full ? 'full' : ''}`}>
      {state.recovery && (
        <div className="banner recovery" data-testid="recovery-banner">
          <span>
            musicGenie didn't close properly last time. Restore the work autosaved
            {state.recovery.savedAt ? ` at ${new Date(state.recovery.savedAt).toLocaleTimeString()}` : ''}?
          </span>
          <button className="primary" onClick={() => store.restoreRecovery()} title="Bring back the song as it was at the last autosave">Restore</button>
          <button onClick={() => store.dismissRecovery()} title="Throw the autosaved copy away and start fresh">Discard</button>
        </div>
      )}
      <ConfirmDialog state={state} store={store} />
      {state.info && (
        <div className="banner info">
          <span>{state.info}</span>
          <button onClick={() => store.clearInfo()} title="Close this message">OK</button>
        </div>
      )}
      {state.busy && <div className="banner info" data-testid="busy"><span>{state.busy}</span></div>}
      {state.error && (
        <div className="banner error">
          <span>{state.error}</span>
          <button onClick={() => store.clearError()} title="Close this message">OK</button>
        </div>
      )}
      {!full && (
        <header className="topbar">
          <div className="brand" title="musicGenie: open or write music, give it instruments and a band, hear it">music<b>Genie</b></div>
          <MenuBar state={state} store={store} player={player} status={status} />
          <WorkspaceTabs state={state} store={store} />
          <WorkspaceTools state={state} store={store} status={status} />
          <span className="spacer" />
          <HelpButton topic="workspaces" label="layout" />
        </header>
      )}
      <PlayBar state={state} store={store} player={player} status={status} />
      {!full && <JobBar />}
      {!full && <EditBar state={state} store={store} player={player} />}
      <TuningDialog state={state} store={store} />
      <RocksmithDialog state={state} store={store} player={player} />
      <ChartDialog state={state} store={store} />
      <DescribeDialog state={state} store={store} />
      <ChangesDialog state={state} store={store} />
      <ExportDialog state={state} store={store} player={player} />
      <div className="main">
        {!full && !showHome && (L.leftOpen ? (
          <>
            <aside className="tracks" style={{ width: L.leftW }} data-testid="tracks-panel">
              <div className="tracks-head">
                <div className="panel-title">
                  <span className="title" title={song?.title}>{song ? song.title : 'No song open'}</span>
                  <HelpButton topic="tracks" label="tracks panel" />
                  <button className="fold" onClick={() => store.setLayout({ leftOpen: false })} title="Fold the tracks panel away to give the music more room" data-testid="left-fold">«</button>
                </div>
                {song && <div className="sub">{song.bars.length} bars · {song.tracks.length} tracks · {song.tempos[0]?.bpm} bpm{state.dirty ? ' · unsaved' : ''}</div>}
              </div>
              {song?.tracks.map((t, i) => <TrackRow key={t.id} track={t} store={store} index={i} selected={!!state.dock && i === state.selTrack} />)}
              {song && <BackingRow song={song} store={store} />}
              {!song && <div className="empty">Open or start a song from the Home screen: its instruments are listed here.</div>}
            </aside>
            <Splitter dir="col" title="Drag to make the tracks panel wider or narrower" testId="left-splitter"
              onDrag={(d, s) => { if (s) startW.current = L.leftW; else store.setLayout({ leftW: Math.max(170, Math.min(520, startW.current + d)) }); }} />
          </>
        ) : (
          <button className="rail" onClick={() => store.setLayout({ leftOpen: true })} title="Show the tracks panel (instruments)" data-testid="left-rail"><span>» Tracks</span></button>
        ))}
        <div className="center">
          <ReviewView state={state} store={store} player={player} status={status} />
          <section className={`score ${L.view === 'page' ? 'paper' : ''}`} ref={scrollRef} data-testid="score">
            <div ref={hostRef} className="at-host" />
            <CursorOverlay state={state} player={player} status={status} />
            <ChordPickerPopover state={state} store={store} />
          </section>
          {showHome && !full && <Home state={state} store={store} />}
          <Dock state={state} store={store} status={status} midi={midi} />
        </div>
        {!full && song && state.workspace === 'arrange' && !state.home && (L.rightOpen ? (
          <>
            <Splitter dir="col" title="Drag to make the band panel wider or narrower" testId="right-splitter"
              onDrag={(d, s) => { if (s) startW.current = L.rightW; else store.setLayout({ rightW: Math.max(240, Math.min(560, startW.current - d)) }); }} />
            <div className="side-right" style={{ width: L.rightW }}>
              <button className="fold right" onClick={() => store.setLayout({ rightOpen: false })} title="Fold the band panel away to give the music more room" data-testid="right-fold">»</button>
              <BandPanel state={state} store={store} status={status} />
            </div>
          </>
        ) : (
          <button className="rail right" onClick={() => store.setLayout({ rightOpen: true })} data-testid="right-rail"
            title="Show the band panel: chords, sections, and a virtual band that plays along (Generate)"><span>🎸 Band «</span></button>
        ))}
      </div>
      {!full && (
        <footer className="status">
          <span>{status?.ready ? 'Player ready' : song ? 'Loading sounds…' : ''}</span>
          {state.lastAutosave && <span>Autosaved {new Date(state.lastAutosave).toLocaleTimeString()}</span>}
          {status && <span data-testid="soundfont" title="The sound set (SoundFont) the instruments play with">Sound: {status.soundFont}</span>}
          {!!status?.swing && <span>Swing {Math.round(status.swing * 100)}%</span>}
          {window.mg.flags.mute && <span className="muted">MUTED (--mute)</span>}
        </footer>
      )}
      <HelpDialog />
      <TourOverlay state={state} store={store} />
    </div>
  );
}

function TrackRow({ track: t, store, index, selected }: { track: Track; store: Store; index: number; selected: boolean }) {
  const fretted = !!t.tuning;
  if (t.audio) {
    return (
      <div className={`track ${selected ? 'selected' : ''}`} data-track={t.id} onMouseDown={() => store.setSelTrack(index)}>
        <div className="row1">
          <span className="name" title={t.name}>🎙 {t.name}</span>
          <span className="tag" title="Audio track: real recorded sound (its clips are in Mix > Audio tracks)">audio · {t.audio.clips.length}</span>
          <button className={`ms ${t.mixer.mute ? 'on mute' : ''}`} title="Mute (M): silence this track, e.g. to play that part yourself" onClick={() => store.setMixer(t.id, { mute: !t.mixer.mute })}>M</button>
          <button className={`ms ${t.mixer.solo ? 'on solo' : ''}`} title="Solo (S): hear only this track (and other soloed ones), e.g. to learn its part" onClick={() => store.setMixer(t.id, { solo: !t.mixer.solo })}>S</button>
        </div>
        <div className="row3">
          <label title="Volume of this track: lower it if it drowns the others">Vol
            <input type="range" min={0} max={1} step={0.01} value={t.mixer.volume} onChange={(e) => store.setMixer(t.id, { volume: Number(e.target.value) })} />
          </label>
          <label title="Pan: place this track more to the left or right speaker">Pan
            <input type="range" min={-1} max={1} step={0.05} value={t.mixer.pan} onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} />
          </label>
          <button onClick={() => store.openDock('audio')} title="Open Mix > Audio tracks to move, trim, fade or record this track's audio">Clips…</button>
        </div>
      </div>
    );
  }
  return (
    <div className={`track ${t.display.visible ? '' : 'hidden'} ${selected ? 'selected' : ''}`} data-track={t.id} onMouseDown={() => store.setSelTrack(index)}>
      <div className="row1">
        <input type="checkbox" checked={t.display.visible} title="Show this track in the score (it still plays when hidden)"
          onChange={(e) => store.setDisplay(t.id, { visible: e.target.checked })} />
        <span className="name" title={t.name}>{t.name}</span>
        {t.generated && (
          <span className={`tag ${hashOf(t.staves) !== t.generated.contentHash ? 'edited' : ''}`}
            title={hashOf(t.staves) !== t.generated.contentHash ? 'Generated, then edited by hand' : `Generated: ${STYLES[t.generated.style].name}, ${t.generated.complexity}, seed ${t.generated.seed}`}>
            {hashOf(t.staves) !== t.generated.contentHash ? 'edited' : STYLES[t.generated.style].name.split(' ')[0]}
          </span>
        )}
        {t.derived && <span className="tag" title="Made by “Split into melody / bass / harmony”">{t.derived.part}</span>}
        <button className={`ms ${t.mixer.mute ? 'on mute' : ''}`} title="Mute (M): silence this track, e.g. to play that part yourself" onClick={() => store.setMixer(t.id, { mute: !t.mixer.mute })}>M</button>
        <button className={`ms ${t.mixer.solo ? 'on solo' : ''}`} title="Solo (S): hear only this track (and other soloed ones), e.g. to learn its part" onClick={() => store.setMixer(t.id, { solo: !t.mixer.solo })}>S</button>
      </div>
      <div className="row2">
        <select value={t.instrument.id} onChange={(e) => store.setInstrument(t.id, e.target.value)} data-tour={index === 0 ? 'instrument' : undefined}
          title="Instrument: which instrument plays this part. Change it to hear the same notes on another instrument.">
          {INSTRUMENT_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {INSTRUMENTS.filter((i) => i.group === g).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={t.display.mode} disabled={!fretted} title="Show this guitar/bass part as sheet music, as tab (string + fret numbers), or both"
          onChange={(e) => store.setDisplay(t.id, { mode: e.target.value as DisplayMode })}>
          <option value="notation">Sheet music</option>
          <option value="tab">Tab</option>
          <option value="both">Sheet music + tab</option>
        </select>
      </div>
      <TuningControls track={t} store={store} />
      <div className="row3">
        <label title="Volume of this track: lower it if it drowns the others">Vol
          <input type="range" min={0} max={1} step={0.01} value={t.mixer.volume}
            onChange={(e) => store.setMixer(t.id, { volume: Number(e.target.value) })} />
        </label>
        <label title="Pan: place this track more to the left or right speaker">Pan
          <input type="range" min={-1} max={1} step={0.1} value={t.mixer.pan}
            onChange={(e) => store.setMixer(t.id, { pan: Number(e.target.value) })} />
        </label>
      </div>
      <div className="row3">
        {!t.instrument.percussion && !t.generated && (
          <button className="split" title="Split into band parts: melody, harmony and bass tracks, e.g. to turn a piano piece into a band arrangement (this track is kept, muted)"
            onClick={() => store.splitTrack(t.id)}>Split into melody / bass / harmony</button>
        )}
        <HarmonyMenu track={t} store={store} />
        {!t.instrument.percussion && (
          <span className="tr" title="Transpose: move only this track's notes up or down by half steps"><span className="lbl">Transpose </span>
            <button onClick={() => store.transpose(-1, t.id)} title="Move this track down a half step (semitone)">−</button>
            <button onClick={() => store.transpose(1, t.id)} title="Move this track up a half step (semitone)">+</button>
          </span>
        )}
      </div>
    </div>
  );
}
