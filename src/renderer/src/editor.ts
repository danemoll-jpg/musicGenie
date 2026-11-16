// Keyboard editing (edit mode). Tab tracks: digits type frets on the cursor string (two digits
// within 0.7 s = one fret, e.g. 1 then 2 = 12), up/down move between strings. Staff (notation)
// tracks: letters A-G enter notes (Shift adds to the chord), up/down change pitch.
import {
  BEND_SHAPES, copyBars, copyBeat, deleteBars, deleteBeat, deleteNote, enterLetter, insertBars, insertBeat, isFretted, makeRest,
  moveCursor, paste, setFret, shiftPitch, stepDuration, toggleDot, toggleTechnique, toggleTie, toggleTriplet,
  type Cursor, type Song, type TechniqueId,
} from '../../model';
import type { ScorePlayer } from './player';
import type { Store } from './store';

/** Is the cursor's track shown as a tab (fret entry) rather than notation (letter entry)? */
export function tabMode(song: Song, c: Cursor): boolean {
  const t = song.tracks[c.track];
  return !!t && isFretted(t) && t.display.mode !== 'notation';
}

let pendingDigit: { value: number; at: number; key: string } | null = null;
const cursorKey = (c: Cursor) => `${c.track}:${c.staff}:${c.bar}:${c.voice}:${c.beat}:${c.string}`;

/** Bend key cycles through the shapes. */
const BEND_CYCLE: TechniqueId[] = ['bendFull', 'bendHalf', 'bendFullHalf', 'bendRelease'];

export const TECH_KEYS: { id: TechniqueId; key: string; label: string; title: string }[] = [
  { id: 'hopo', key: 'H', label: 'H/P', title: 'Hammer-on / pull-off (H; direction from the previous note on the string). P = pull-off' },
  { id: 'slide', key: 'S', label: '/', title: 'Slide to the next note (S). Shift+S = legato slide' },
  { id: 'slideOutDown', key: 'U', label: '\\', title: 'Unpitched slide out, down (U). Shift+U = up' },
  { id: 'bendFull', key: 'B', label: 'b', title: 'Bend (B cycles: full, ½, 1½, bend + release)' },
  { id: 'vibrato', key: 'V', label: '~', title: 'Vibrato (V)' },
  { id: 'palmMute', key: 'M', label: 'PM', title: 'Palm mute (M)' },
  { id: 'dead', key: 'X', label: 'x', title: 'Fret-hand mute / dead note (X)' },
  { id: 'harmonic', key: 'N', label: '<>', title: 'Natural harmonic (N). Shift+N = pinch harmonic' },
  { id: 'pinchHarmonic', key: 'Shift+N', label: 'PH', title: 'Pinch harmonic (Shift+N)' },
  { id: 'tap', key: 'T', label: 'T', title: 'Tap (T)' },
  { id: 'slap', key: 'K', label: 'S', title: 'Slap (K)' },
  { id: 'pop', key: 'O', label: 'P', title: 'Pop (O)' },
  { id: 'accent', key: '>', label: '>', title: 'Accent (>)' },
  { id: 'tremolo', key: 'W', label: '≡', title: 'Tremolo picking (W)' },
];

export function applyTechnique(store: Store, id: TechniqueId) {
  const song = store.state.song;
  const c = store.state.cursor;
  if (!song || !c) return;
  const whole = !tabMode(song, c);
  if (id === 'bendFull') {
    // Cycle: none -> full -> half -> 1.5 -> release -> none
    const n = song.tracks[c.track].staves[c.staff].measures[c.bar].voices[c.voice].beats[c.beat]?.notes
      .find((x) => (whole ? true : x.string === c.string));
    const cur = BEND_CYCLE.findIndex((b) => n?.techniques?.bend && JSON.stringify(n.techniques.bend) === JSON.stringify(BEND_SHAPE(b)));
    if (cur < 0) return store.editAt((s, cc) => toggleTechnique(s, cc, 'bendFull', whole), 'Bend');
    const next = BEND_CYCLE[cur + 1];
    store.editAt((s, cc) => toggleTechnique(s, cc, BEND_CYCLE[cur], whole), 'Bend');
    if (next) store.editAt((s, cc) => toggleTechnique(s, cc, next, whole), 'Bend');
    return;
  }
  store.editAt((s, cc) => toggleTechnique(s, cc, id, whole), 'Technique');
}

const BEND_SHAPE = (id: TechniqueId) => BEND_SHAPES[id as keyof typeof BEND_SHAPES];

export function copySelection(store: Store, player: ScorePlayer | null) {
  const song = store.state.song;
  const c = store.state.cursor;
  if (!song || !c) return;
  const r = player?.status.range;
  store.setClip(r ? copyBars(song, c, r.startBar, r.endBar) : copyBeat(song, c));
}

/** Handle a key in edit mode. Returns true when the key was used. */
export function editorKey(store: Store, player: ScorePlayer | null, e: KeyboardEvent): boolean {
  const song = store.state.song;
  const c = store.state.cursor;
  if (!store.state.editMode || !song || !c) return false;
  const tab = tabMode(song, c);
  const k = e.key;
  const lower = k.length === 1 ? k.toLowerCase() : k;
  const move = (dir: 'left' | 'right' | 'up' | 'down') => store.setCursor(moveCursor(song, c, dir));

  if (e.ctrlKey) {
    if (lower === 'c') { copySelection(store, player); return true; }
    if (lower === 'v') {
      const clip = store.getClip();
      if (clip) store.editAt((s, cc) => paste(s, cc, clip), 'Paste');
      return true;
    }
    if (k === 'Insert') { store.editAt((s, cc) => insertBars(s, cc.bar, 1), 'Insert bar'); return true; }
    if (k === 'Delete') {
      const r = player?.status.range;
      store.editAt((s, cc) => deleteBars(s, r?.startBar ?? cc.bar, r?.endBar ?? cc.bar), 'Delete bar');
      player?.clearRange();
      return true;
    }
    return false;
  }
  if (e.altKey) return false;

  switch (k) {
    case 'ArrowLeft': move('left'); return true;
    case 'ArrowRight': move('right'); return true;
    case 'ArrowUp':
    case 'ArrowDown': {
      const up = k === 'ArrowUp';
      if (tab && !e.shiftKey) move(up ? 'up' : 'down');
      else store.editAt((s, cc) => shiftPitch(s, cc, (up ? 1 : -1) * (e.ctrlKey ? 12 : 1), !tab), up ? 'Pitch up' : 'Pitch down');
      return true;
    }
    case 'Delete':
    case 'Backspace':
      if (e.shiftKey) store.editAt(deleteBeat, 'Delete beat');
      else store.editAt((s, cc) => deleteNote(s, cc, !tab), 'Delete note');
      return true;
    case 'Insert': store.editAt(insertBeat, 'Insert beat'); return true;
    case 'Escape': store.setEditMode(false); return true;
    case ']': case '+': store.editAt((s, cc) => stepDuration(s, cc, 1), 'Shorter'); return true;
    case '[': case '-': store.editAt((s, cc) => stepDuration(s, cc, -1), 'Longer'); return true;
    case '.': store.editAt(toggleDot, 'Dot'); return true;
    case '>': applyTechnique(store, 'accent'); return true;
  }

  // Fret digits (tab)
  if (tab && /^[0-9]$/.test(k)) {
    const d = Number(k);
    const now = performance.now();
    const key = cursorKey(c);
    let fret = d;
    if (pendingDigit && pendingDigit.key === key && now - pendingDigit.at < 700 && pendingDigit.value * 10 + d <= 24) {
      fret = pendingDigit.value * 10 + d;
      pendingDigit = null;
    } else {
      pendingDigit = d <= 2 ? { value: d, at: now, key } : null;
    }
    store.editAt((s, cc) => setFret(s, cc, fret), 'Fret ' + fret);
    return true;
  }

  // Note letters (staff)
  if (!tab && /^[a-g]$/i.test(k)) {
    store.editAt((s, cc) => enterLetter(s, cc, k, e.shiftKey), 'Note ' + k.toUpperCase());
    return true;
  }

  switch (lower) {
    case 'r': store.editAt(makeRest, 'Rest'); return true;
    case 'l': store.editAt(toggleTie, 'Tie'); return true;
    case 'h': applyTechnique(store, 'hopo'); return true;
    case 'p': applyTechnique(store, 'pullOff'); return true;
    case 's': applyTechnique(store, e.shiftKey ? 'slideLegato' : 'slide'); return true;
    case 'u': applyTechnique(store, e.shiftKey ? 'slideOutUp' : 'slideOutDown'); return true;
    case 'b': if (tab) { applyTechnique(store, 'bendFull'); return true; } return false;
    case 'v': applyTechnique(store, 'vibrato'); return true;
    case 'm': applyTechnique(store, 'palmMute'); return true;
    case 'x': applyTechnique(store, 'dead'); return true;
    case 'n': applyTechnique(store, e.shiftKey ? 'pinchHarmonic' : 'harmonic'); return true;
    case 't':
      if (e.shiftKey) store.editAt(toggleTriplet, 'Triplet');
      else applyTechnique(store, 'tap');
      return true;
    case 'k': applyTechnique(store, 'slap'); return true;
    case 'o': applyTechnique(store, 'pop'); return true;
    case 'w': applyTechnique(store, 'tremolo'); return true;
  }
  return false;
}
