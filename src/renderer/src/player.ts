// alphaTab wrapper: renders the model and plays it. alphaTab objects never leave this file
// except as read-only lookups.
import * as alphaTab from '@coderline/alphatab';
import type { Song } from '../../model/types';
import { applySwing } from '../../render/swing';
import { toAlphaTabScore } from '../../render/toAlphaTab';
import { engine } from './audio/engine';
import { ClipPlayer } from './audio/clips';

export const DEFAULT_SOUNDFONT = 'GeneralUser GS 2.0.3';

export interface PlayerStatus {
  ready: boolean;
  playing: boolean;
  currentBar: number;
  tick: number;
  /** The play position in model ticks (repeats folded back onto their bars). */
  songTick: number;
  endTick: number;
  looping: boolean;
  range: { startBar: number; endBar: number } | null;
  renderCount: number;
  /** Name of the loaded SoundFont and how many SoundFont loads finished. */
  soundFont: string;
  soundFontLoads: number;
  swing: number;
}

type Listener = (s: PlayerStatus) => void;

/** A clicked beat in model terms (alphaTab indices match the model's: one alphaTab beat per model beat). */
export interface BeatHit {
  track: number;
  staff: number;
  bar: number;
  voice: number;
  beat: number;
  /** String of the clicked note, if a note was hit. */
  string?: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Everything that needs a re-render (mixer, effects, automation and audio clips do not). */
function stripMixer(song: Song): string {
  return JSON.stringify({
    ...song, mix: null,
    tracks: song.tracks.map((t) => ({ ...t, mixer: null, automation: null, audio: t.audio ? 1 : null })),
  });
}

export class ScorePlayer {
  readonly api: alphaTab.AlphaTabApi;
  private listeners = new Set<Listener>();
  private lastStructure = '';
  private lastSong: Song | null = null;
  private lastLoadId = -1;
  readonly clips = new ClipPlayer(engine);
  private resumeAfterLoad: { tick: number; play: boolean } | null = null;
  status: PlayerStatus = {
    ready: false, playing: false, currentBar: 0, tick: 0, songTick: 0, endTick: 0, looping: false, range: null, renderCount: 0,
    soundFont: DEFAULT_SOUNDFONT, soundFontLoads: 0, swing: 0,
  };
  private swing = 0;
  private readonly defaultSoundFontUrl: string;
  private renderWaiters: (() => void)[] = [];
  /** Edit mode: a click selects the beat instead of playing from it. */
  editMode = false;
  onBeatClick: ((hit: BeatHit) => void) | null = null;
  private lastDown = { x: 0, y: 0 };
  private pendingScore: alphaTab.model.Score | null = null;
  private soundFontRequested = false;

  private flushRenderWaiters() {
    const w = this.renderWaiters;
    this.renderWaiters = [];
    w.forEach((f) => f());
  }

  constructor(host: HTMLElement, scrollEl: HTMLElement) {
    const s = new alphaTab.Settings();
    const base = new URL('./', location.href).href;
    s.core.fontDirectory = base + 'font/';
    s.core.enableLazyLoading = false;
    s.core.useWorkers = false; // render on the page thread: simpler, errors surface, scores are small
    s.core.logLevel = alphaTab.LogLevel.Warning;
    // The player is created below through our own factory (Round 5 engine: per-track outputs).
    s.player.playerMode = alphaTab.PlayerMode.Disabled;
    this.defaultSoundFontUrl = base + 'sounds/GeneralUser-GS.sf2';
    s.player.soundFont = this.defaultSoundFontUrl;
    s.player.scrollElement = scrollEl;
    s.player.enableCursor = true;
    s.player.enableAnimatedBeatCursor = true;
    s.player.enableElementHighlighting = true;
    s.player.enableUserInteraction = true;
    s.player.enablePlaybackRangeSelection = true;
    s.display.scale = 0.9;
    this.api = new alphaTab.AlphaTabApi(host, s);

    const a = this.api;
    const facade = a.uiFacade as unknown as { createWorkerPlayer: () => unknown };
    facade.createWorkerPlayer = () => {
      const synth = engine.createSynth();
      synth.ready.on(() => {
        if (!this.soundFontRequested) a.loadSoundFontFromUrl(this.defaultSoundFontUrl, false);
      });
      return synth;
    };
    s.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
    a.updateSettings();
    engine.modelTick = (t) => this.modelTick(t);
    this.clips.occurrences = (bar) => this.occurrences(bar);
    a.playerReady.on(() => this.update({ ready: true }));
    a.soundFontLoaded.on(() => this.update({ soundFontLoads: this.status.soundFontLoads + 1 }));
    // Swing is a playback feel: shift off-beat 8ths in the generated MIDI, never in the score.
    a.midiLoad.on((file) => {
      applySwing(file as unknown as Parameters<typeof applySwing>[0], this.swing);
      this.filterAudioTracks(file);
    });
    a.playerStateChanged.on((e) => this.update({ playing: e.state === alphaTab.synth.PlayerState.Playing }));
    a.playerPositionChanged.on((e) => this.update({ tick: e.currentTick, songTick: this.modelTick(e.currentTick), endTick: e.endTick }));
    a.playedBeatChanged.on((beat) => this.update({ currentBar: beat.voice.bar.index }));
    a.error.on((e) => console.error('alphaTab error:', e?.message ?? e, e?.stack ?? ''));
    a.renderFinished.on(() => this.update({ renderCount: this.status.renderCount + 1 }));
    // postRenderFinished = everything drawn. Only the newest requested render counts.
    a.postRenderFinished.on(() => {
      const drawn = a.score;
      setTimeout(() => {
        if (drawn === this.pendingScore && a.score === drawn) {
          this.pendingScore = null;
          this.flushRenderWaiters();
        }
      }, 50);
    });
    a.midiLoaded.on(() => {
      // Mute/solo/volume/pan live in the mixer graph (engine), not in alphaTab's synth.
      const r = this.resumeAfterLoad;
      this.resumeAfterLoad = null;
      if (r) {
        a.tickPosition = r.tick;
        if (r.play) a.play();
      }
    });
    a.playbackRangeChanged?.on?.((e: { playbackRange: alphaTab.synth.PlaybackRange | null }) => {
      this.update({ range: this.rangeToBars(e.playbackRange) });
    });
    // Click a single beat (no drag) -> play from there.
    let downBeat: alphaTab.model.Beat | null = null;
    host.addEventListener('mousedown', (e) => {
      const r = host.getBoundingClientRect();
      this.lastDown = { x: e.clientX - r.left, y: e.clientY - r.top };
    }, true);
    a.beatMouseDown.on((b) => (downBeat = b));
    a.beatMouseUp.on((b) => {
      if (this.editMode && b && downBeat && b === downBeat) {
        downBeat = null;
        const note = a.boundsLookup?.getNoteAtPos(b, this.lastDown.x, this.lastDown.y) ?? null;
        this.onBeatClick?.({
          track: b.voice.bar.staff.track.index, staff: b.voice.bar.staff.index, bar: b.voice.bar.index,
          voice: b.voice.index, beat: b.index, string: note?.string,
        });
        return;
      }
      if (b && downBeat && b === downBeat && this.status.ready) {
        a.tickPosition = b.absolutePlaybackStart;
        if (!this.status.playing) a.play();
      }
      downBeat = null;
    });
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(p: Partial<PlayerStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((f) => f(this.status));
  }

  private rangeToBars(r: alphaTab.synth.PlaybackRange | null) {
    if (!r || !this.api.score) return null;
    const bars = this.api.score.masterBars;
    const barAt = (tick: number) => {
      let i = 0;
      while (i + 1 < bars.length && bars[i + 1].start <= tick) i++;
      return i;
    };
    return { startBar: barAt(r.startTick), endBar: barAt(Math.max(r.startTick, r.endTick - 1)) };
  }

  /** Show a song. Mixer-only changes are applied live; anything else re-renders. */
  show(song: Song, loadId = 0) {
    const structure = stripMixer(song);
    const newFile = loadId !== this.lastLoadId;
    this.lastLoadId = loadId;
    if (!newFile && this.lastSong && structure === this.lastStructure && this.api.score) {
      engine.setSong(song, null);
      this.clips.setSong(song);
      this.lastSong = song;
      // Nothing to redraw: the view is up to date once any render in flight is drawn.
      if (!this.pendingScore) this.flushRenderWaiters();
      return;
    }
    const wasPlaying = this.status.playing;
    const tick = this.api.tickPosition;
    const first = !this.lastSong || newFile;
    this.lastStructure = structure;
    this.lastSong = song;
    this.swing = song.playback?.swing ?? 0;
    this.update({ swing: this.swing });
    const score = toAlphaTabScore(song, this.api.settings);
    const visible = song.tracks.map((t, i) => (t.display.visible ? i : -1)).filter((i) => i >= 0);
    engine.setSong(song, score.tracks.map((t) => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]));
    this.clips.setSong(song);
    if (!first) {
      if (wasPlaying) this.api.pause();
      this.resumeAfterLoad = { tick, play: wasPlaying };
    }
    // A loop/selection points at beats of the old score: drop it before re-rendering.
    this.clearRange();
    this.pendingScore = score;
    this.api.renderScore(score, visible.length ? visible : [0]);
  }

  /** Audio tracks have no notes to play: drop their (program change) MIDI events. */
  filterAudioTracks(file: unknown) {
    const song = this.lastSong;
    const idx = new Set(song?.tracks.map((t, i) => (t.audio ? i : -1)).filter((i) => i >= 0) ?? []);
    if (!idx.size) return;
    const f = file as { tracks: { events: { track: number }[] }[] };
    for (const t of f.tracks) t.events = t.events.filter((e) => !idx.has(e.track));
  }

  /** Playback ticks where a model bar starts (one per pass through repeats). */
  occurrences(bar: number): number[] {
    const lookups = this.api.tickCache?.masterBars;
    if (!lookups?.length) return [this.barStartTick(bar)];
    const out = lookups.filter((l) => l.masterBar.index === bar).map((l) => l.start);
    return out.length ? out : [this.barStartTick(bar)];
  }

  /** Load a SoundFont (bytes of a .sf2/.sf3), or the bundled default with null. */
  setSoundFont(bytes: Uint8Array | null, name: string) {
    const wasPlaying = this.status.playing;
    if (wasPlaying) this.api.pause();
    this.api.resetSoundFonts();
    this.soundFontRequested = true;
    if (bytes) this.api.loadSoundFont(bytes, false);
    else this.api.loadSoundFont(this.defaultSoundFontUrl, false);
    this.update({ soundFont: name });
  }

  /** Wait until n SoundFont loads have finished in total. */
  waitSoundFontLoads(n: number, timeoutMs = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (this.status.soundFontLoads >= n) resolve(true);
        else if (performance.now() - t0 > timeoutMs) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    });
  }

  waitForRender(timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('render did not finish in time')), timeoutMs);
      this.renderWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  playPause() {
    this.api.playPause();
  }
  play() {
    this.api.play();
  }
  pause() {
    this.api.pause();
    // The worker reports the new state later; a re-render before that must not resume playback.
    this.resumeAfterLoad = null;
    this.update({ playing: false });
  }
  stop() {
    this.api.stop();
    this.resumeAfterLoad = null;
    this.update({ playing: false });
    this.update({ currentBar: this.api.playbackRange ? this.status.range?.startBar ?? 0 : 0 });
  }
  setLooping(on: boolean) {
    this.api.isLooping = on;
    this.update({ looping: on });
  }
  setSpeed(pct: number) {
    this.api.playbackSpeed = pct / 100;
  }
  setMetronome(on: boolean) {
    this.api.metronomeVolume = on ? 1 : 0;
  }
  setCountIn(on: boolean) {
    this.api.countInVolume = on ? 1 : 0;
  }

  /** Playback tick where a bar first plays (alphaTab plays repeats unrolled). */
  barStartTick(bar: number): number {
    const mb = this.api.score?.masterBars[bar];
    if (!mb) return 0;
    try {
      return this.api.tickCache?.getMasterBarStart(mb) ?? mb.start;
    } catch {
      return mb.start;
    }
  }

  /** Playback tick -> model tick (a repeated bar maps back onto its own bar). */
  modelTick(playTick: number): number {
    const lookups = this.api.tickCache?.masterBars;
    if (!lookups?.length) return playTick;
    let lo = 0;
    let hi = lookups.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lookups[mid].start <= playTick) lo = mid;
      else hi = mid - 1;
    }
    const l = lookups[lo];
    return l.masterBar.start + Math.max(0, playTick - l.start);
  }

  seekBar(bar: number) {
    this.api.tickPosition = this.barStartTick(bar);
    this.update({ currentBar: bar });
  }

  /** Select bars [startBar, endBar] as the playback/loop range (same as dragging over them). */
  selectBars(startBar: number, endBar: number) {
    const staff = this.api.score?.tracks.find((t) => t.isVisibleOnMultiTrack)?.staves[0] ?? this.api.score?.tracks[0].staves[0];
    if (!staff) return;
    const first = staff.bars[startBar].voices[0].beats[0];
    const lastBar = staff.bars[endBar].voices[0];
    const last = lastBar.beats[lastBar.beats.length - 1];
    this.api.highlightPlaybackRange(first, last);
    this.api.applyPlaybackRangeFromHighlight();
    this.update({ range: { startBar, endBar } });
  }

  /** Bar index under a point in the score panel (host coordinates, px), or -1. */
  barAtPoint(x: number, y: number): number {
    const systems = this.api.boundsLookup?.staffSystems ?? [];
    let sys = systems.find((s) => y >= s.realBounds.y && y < s.realBounds.y + s.realBounds.h);
    if (!sys) sys = systems.find((s) => y < s.realBounds.y); // just above a system: its chord/section band
    if (!sys) return -1;
    const mb = sys.bars.find((b) => x >= b.realBounds.x && x < b.realBounds.x + b.realBounds.w);
    return mb ? mb.index : -1;
  }

  /** Where a model beat (and the note on `string`) is drawn, in host pixels. */
  beatRects(c: { track: number; staff: number; bar: number; voice: number; beat: number; string: number }): { beat: Rect; note: Rect | null; bar: Rect } | null {
    const voice = this.api.score?.tracks[c.track]?.staves[c.staff]?.bars[c.bar]?.voices[c.voice];
    if (!voice?.beats.length) return null;
    const beat = voice.beats[Math.min(c.beat, voice.beats.length - 1)];
    const bb = this.api.boundsLookup?.findBeat(beat);
    if (!bb) return null;
    const vb = bb.visualBounds;
    const barB = bb.barBounds.visualBounds; // this staff only (not the whole system)
    const nb = bb.notes?.find((n) => n.note.string === c.string)?.noteHeadBounds ?? null;
    return {
      beat: { x: vb.x, y: barB.y, w: Math.max(8, vb.w), h: barB.h },
      note: nb ? { x: nb.x, y: nb.y, w: nb.w, h: nb.h } : null,
      bar: { x: barB.x, y: barB.y, w: barB.w, h: barB.h },
    };
  }

  clearRange() {
    this.api.clearPlaybackRangeHighlight();
    // alphaTab 1.9 keeps the selected beats privately and redraws them after the next render,
    // which crashes when they belong to an older score. Forget them too.
    const internal = this.api as unknown as { _selectionStart?: unknown; _selectionEnd?: unknown };
    internal._selectionStart = undefined;
    internal._selectionEnd = undefined;
    this.api.playbackRange = null;
    this.update({ range: null });
  }
}
