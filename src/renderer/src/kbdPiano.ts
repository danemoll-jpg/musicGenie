// Computer keyboard as a piano (Round 5): only while the "Keyboard piano" toggle is on.
//   A S D F G H J K L ; '  = white keys C D E F G A B C D E F
//   W E   T Y U   O P      = black keys C# D#  F# G# A#  C# D#
//   Z / X = octave down / up, C / V = velocity down / up
// Notes go through the MIDI controller as note on/off messages, so hearing, step entry and
// recording work exactly like a MIDI keyboard.
import type { MidiController } from './midi';
import type { Store } from './store';

const WHITE: Record<string, number> = { a: 0, s: 2, d: 4, f: 5, g: 7, h: 9, j: 11, k: 12, l: 14, ';': 16, "'": 17 };
const BLACK: Record<string, number> = { w: 1, e: 3, t: 6, y: 8, u: 10, o: 13, p: 15 };
export const KEY_OFFSETS: Record<string, number> = { ...WHITE, ...BLACK };

export interface KbdState {
  octave: number;
  velocity: number;
  held: string[];
}

export class KeyboardPiano {
  state: KbdState = { octave: 4, velocity: 96, held: [] };
  private down = new Map<string, number>(); // key -> pitch
  private listeners = new Set<(s: KbdState) => void>();

  constructor(private store: Store, private midi: MidiController) {
    // Capture phase, before the app's shortcuts: while on, these keys are the piano's.
    window.addEventListener('keydown', (e) => this.onDown(e), true);
    window.addEventListener('keyup', (e) => this.onUp(e), true);
    window.addEventListener('blur', () => this.allOff());
  }

  on(fn: (s: KbdState) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private set(p: Partial<KbdState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f(this.state));
  }

  /** MIDI note for a key at the current octave (C of `octave` = 12 * (octave + 1)). */
  pitchFor(key: string): number | null {
    const off = KEY_OFFSETS[key];
    return off === undefined ? null : 12 * (this.state.octave + 1) + off;
  }

  private active(e: KeyboardEvent) {
    if (!this.store.state.kbdPiano || e.ctrlKey || e.altKey || e.metaKey) return false;
    const tag = (e.target as HTMLElement)?.tagName;
    return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  }

  private onDown(e: KeyboardEvent) {
    if (!this.active(e)) return;
    const key = e.key.toLowerCase();
    let used = true;
    if (key === 'z') this.set({ octave: Math.max(0, this.state.octave - 1) });
    else if (key === 'x') this.set({ octave: Math.min(8, this.state.octave + 1) });
    else if (key === 'c') this.set({ velocity: Math.max(8, this.state.velocity - 16) });
    else if (key === 'v') this.set({ velocity: Math.min(127, this.state.velocity + 16) });
    else if (KEY_OFFSETS[key] !== undefined) {
      if (!e.repeat && !this.down.has(key)) {
        const pitch = this.pitchFor(key)!;
        if (pitch <= 127) {
          this.down.set(key, pitch);
          this.midi.handle({ time: performance.now(), data: [0x90, pitch, this.state.velocity] });
          this.set({ held: [...this.down.keys()] });
        }
      }
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private onUp(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    const pitch = this.down.get(key);
    if (pitch === undefined) return;
    this.down.delete(key);
    this.midi.handle({ time: performance.now(), data: [0x80, pitch, 0] });
    this.set({ held: [...this.down.keys()] });
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  allOff() {
    for (const p of this.down.values()) this.midi.handle({ time: performance.now(), data: [0x80, p, 0] });
    this.down.clear();
    this.set({ held: [] });
  }
}
