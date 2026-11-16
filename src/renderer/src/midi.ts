// MIDI keyboard: Web MIDI input (device picker), playing through the selected track's sound,
// step entry at the edit cursor, and live recording (count-in, metronome, quantise) into the
// selected track. Tests feed a simulated input through the same path (simulate()).
import {
  barAtTick, barStartTicks, mergeTake, MidiRecorder, moveCursor, PPQ, quantizeNotes, setBeatPitches, songTicks, tempoPoints,
  type MidiMessage, type Quantize,
} from '../../model';
import { liveSynth } from './audio/liveSynth';
import type { ScorePlayer } from './player';
import type { Store } from './store';

export interface MidiState {
  supported: boolean;
  inputs: { id: string; name: string }[];
  inputId: string | null;
  monitor: boolean;
  step: boolean;
  quantize: Quantize;
  mode: 'merge' | 'replace';
  countIn: boolean;
  metronome: boolean;
  recording: { startBar: number; notes: number } | null;
  lastTake: { notes: number; fromBar: number; toBar: number } | null;
  /** Keys held right now (for the panel). */
  held: number[];
  error: string | null;
}

export class MidiController {
  state: MidiState = {
    supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    inputs: [], inputId: null, monitor: true, step: false, quantize: '16', mode: 'merge', countIn: true, metronome: true,
    recording: null, lastTake: null, held: [], error: null,
  };
  private access: MIDIAccess | null = null;
  private listeners = new Set<(s: MidiState) => void>();
  private rec: { raw: MidiMessage[]; anchors: { perf: number; tick: number }[]; startTick: number; startBar: number; trackIndex: number; practice: { metronome: boolean; countIn: boolean }; off: () => void } | null = null;
  private stepBuf: { pitches: number[]; timer: ReturnType<typeof setTimeout> | null } = { pitches: [], timer: null };
  /** Messages seen (tests). */
  received = 0;

  constructor(private store: Store, private player: () => ScorePlayer | null) {}

  on(fn: (s: MidiState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(p: Partial<MidiState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f(this.state));
  }
  setOptions(p: Partial<Pick<MidiState, 'monitor' | 'step' | 'quantize' | 'mode' | 'countIn' | 'metronome'>>) {
    this.set(p);
  }

  async init() {
    if (!this.state.supported || this.access) return this.refresh();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.refresh();
      const st = await window.mg.settingsGet();
      this.refresh();
      const want = st.midiInput ?? null;
      if (want && this.state.inputs.some((i) => i.id === want)) this.select(want);
      else if (this.state.inputs[0]) this.select(this.state.inputs[0].id);
    } catch (e) {
      this.set({ error: 'MIDI is not available: ' + (e as Error).message });
    }
  }

  refresh() {
    const inputs: { id: string; name: string }[] = [];
    this.access?.inputs.forEach((i) => inputs.push({ id: i.id, name: i.name ?? i.id }));
    this.set({ inputs, inputId: inputs.some((i) => i.id === this.state.inputId) ? this.state.inputId : null });
  }

  select(id: string | null) {
    this.access?.inputs.forEach((i) => {
      i.onmidimessage = i.id === id ? (e: MIDIMessageEvent) => this.handle({ time: e.timeStamp, data: [...(e.data ?? [])] }) : null;
    });
    this.set({ inputId: id });
    void window.mg.settingsSet({ midiInput: id });
  }

  /** Every MIDI message (device or simulated) comes through here. */
  handle(m: MidiMessage) {
    this.received++;
    const [status, pitch, vel = 0] = m.data;
    const kind = status & 0xf0;
    const isOn = kind === 0x90 && vel > 0;
    const isOff = kind === 0x80 || (kind === 0x90 && vel === 0);
    if (!isOn && !isOff) return;
    const song = this.store.state.song;
    const t = song?.tracks[this.store.state.selTrack];
    if (isOn) {
      this.set({ held: [...this.state.held.filter((p) => p !== pitch), pitch] });
      if (this.state.monitor && t) void liveSynth.noteOn(pitch, vel, t.instrument.program, t.instrument.percussion);
    } else {
      this.set({ held: this.state.held.filter((p) => p !== pitch) });
      if (this.state.monitor) liveSynth.noteOff(pitch);
    }
    if (this.rec) {
      this.rec.raw.push(m);
      if (isOn) this.set({ recording: { startBar: this.rec.startBar, notes: (this.state.recording?.notes ?? 0) + 1 } });
      return;
    }
    if (isOn && this.state.step && this.store.state.editMode && this.store.state.cursor) this.stepNote(pitch);
  }

  /** Step entry: keys pressed within 80 ms of each other form one chord, entered at the cursor. */
  private stepNote(pitch: number) {
    const b = this.stepBuf;
    b.pitches.push(pitch);
    if (b.timer) clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      const ps = b.pitches.slice();
      b.pitches = [];
      b.timer = null;
      this.store.editAt((s, c) => setBeatPitches(s, c, ps), 'Step entry', (s, c) => moveCursor(s, c, 'right'));
    }, 80);
  }

  /** Start recording into the selected track from the cursor bar (or the bar the player is at). */
  startRecording() {
    const p = this.player();
    const song = this.store.state.song;
    if (!p || !song || this.rec) return;
    const ti = this.store.state.selTrack;
    const c = this.store.state.cursor;
    const startBar = c && c.track === ti ? c.bar : p.status.currentBar;
    const practice = { metronome: this.store.state.practice.metronome, countIn: this.store.state.practice.countIn };
    this.store.setPractice({ metronome: this.state.metronome, countIn: this.state.countIn });
    p.setMetronome(this.state.metronome);
    p.setCountIn(this.state.countIn);
    const startTick = barStartTicks(song)[startBar] ?? 0;
    const anchors: { perf: number; tick: number }[] = [];
    let lastTick = -1;
    const off = p.on((st) => {
      if (!st.playing) return;
      if (st.songTick !== lastTick && (st.songTick >= startTick || lastTick >= 0)) {
        if (lastTick >= 0 || st.songTick > startTick) anchors.push({ perf: performance.now(), tick: st.songTick });
        lastTick = st.songTick;
      }
    });
    this.rec = { raw: [], anchors, startTick, startBar, trackIndex: ti, practice, off };
    this.set({ recording: { startBar, notes: 0 } });
    p.seekBar(startBar);
    p.play();
  }

  /** Stop: quantise the take and put it into the track (one undo step). Returns the number of notes. */
  stopRecording(): number {
    const r = this.rec;
    const p = this.player();
    if (!r) return 0;
    this.rec = null;
    r.off();
    p?.pause();
    liveSynth.allOff();
    this.store.setPractice(r.practice);
    const song = this.store.state.song!;
    const pts = tempoPoints(song);
    const speed = this.store.state.practice.speed / 100;
    const bpmAt = (tick: number) => {
      let b = pts[0].bpm;
      for (const x of pts) if (x.tick <= tick) b = x.bpm;
      return b;
    };
    const anchors = r.anchors.length ? r.anchors : [{ perf: performance.now(), tick: r.startTick }];
    const clock = (time: number) => {
      let a = anchors[0];
      for (const x of anchors) if (x.perf <= time) a = x;
      return a.tick + ((time - a.perf) * PPQ * bpmAt(a.tick) * speed) / 60000;
    };
    const recorder = new MidiRecorder(clock);
    for (const m of r.raw) recorder.message(m);
    const endTime = performance.now();
    const raw = recorder.finish(endTime);
    const endTick = Math.min(songTicks(song), Math.max(r.startTick, Math.ceil(clock(endTime))));
    const notes = quantizeNotes(raw, this.state.quantize, r.startTick, endTick);
    const toBar = Math.max(r.startBar, barAtTick(song, Math.max(0, endTick - 1)));
    if (notes.length || this.state.mode === 'replace') {
      this.store.tryEdit((s) => mergeTake(s, r.trackIndex, notes, r.startTick, endTick, this.state.mode), 'Record MIDI (' + notes.length + ' notes)');
    }
    this.set({ recording: null, lastTake: { notes: notes.length, fromBar: r.startBar, toBar }, held: [] });
    return notes.length;
  }

  /** Feed messages as if a keyboard played them: each after `delay` ms (tests use this). */
  async simulate(msgs: { delay: number; data: number[] }[]) {
    for (const m of msgs) {
      if (m.delay > 0) await new Promise((res) => setTimeout(res, m.delay));
      this.handle({ time: performance.now(), data: m.data });
    }
  }
}
