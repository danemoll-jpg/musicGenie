// A small live instrument for previews (chord explorer, piano-roll keys) and the MIDI keyboard.
// alphaTab's own player runs in a worker and can only play whole MIDI files (which stops the song),
// so this keeps a second alphaTab synthesizer on the page thread and drives its note on/off
// directly, pulling samples through a ScriptProcessor. Its output goes to the speakers through
// the master bus like everything else, so --mute silences it.
import * as alphaTab from '@coderline/alphatab';
import { engine } from './engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tsf = {
  loadPresets(hydra: unknown, programs: Set<number>, keys: Set<number>, append: boolean): void;
  channelSetPresetNumber(ch: number, program: number, drums?: boolean): boolean;
  channelSetBank(ch: number, bank: number): void;
  channelSetMixVolume(ch: number, v: number): void;
  channelSetVolume(ch: number, v: number): void;
  channelNoteOn(ch: number, key: number, vel: number): void;
  channelNoteOff(ch: number, key: number): void;
  noteOffAll(immediate: boolean): void;
  synthesize(buf: Float32Array, pos: number, frames: number): unknown;
  setOutput(mode: number, sampleRate: number, gainDb: number): void;
};

const emitter = () => ({ on: () => {}, off: () => {}, trigger: () => {} });

export class LiveSynth {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private synth: any = null;
  private tsf: Tsf | null = null;
  private programs = new Set<number>();
  private soundFont: Uint8Array | null = null;
  private soundFontName = '';
  private loading: Promise<void> | null = null;
  private held = new Map<number, number>(); // key -> channel
  /** Notes started (tests read this to see that a preview really played). */
  notesPlayed = 0;

  /** Use this SoundFont (bytes) from now on. */
  setSoundFont(bytes: Uint8Array | null, name: string) {
    this.soundFont = bytes;
    this.soundFontName = name;
    this.tsf = null;
    this.loading = null;
  }

  private async ensure(): Promise<Tsf | null> {
    if (this.tsf) return this.tsf;
    if (!this.loading) this.loading = this.init();
    await this.loading;
    return this.tsf;
  }

  private async init() {
    let bytes = this.soundFont;
    if (!bytes) {
      const r = await fetch(new URL('./sounds/GeneralUser-GS.sf2', location.href).href);
      bytes = new Uint8Array(await r.arrayBuffer());
      this.soundFont = bytes;
      this.soundFontName = 'default';
    }
    if (!this.ctx) {
      // Round 5: the engine's context, so live notes go through a track's strip (its effects).
      this.ctx = engine.ctx;
      const node = this.ctx.createScriptProcessor(1024, 0, 2);
      node.onaudioprocess = (e) => this.render(e);
      this.node = node;
      this.reroute();
    }
    const output = {
      sampleRate: this.ctx.sampleRate,
      ready: emitter(), sampleRequest: emitter(), samplesPlayed: emitter(),
      open() {}, activate() {}, play() {}, pause() {}, resetSamples() {}, addSamples() {}, destroy() {},
      enumerateOutputDevices: async () => [], setOutputDevice: async () => {}, getOutputDevice: async () => null,
    };
    const synth = new alphaTab.synth.AlphaSynth(output as unknown as alphaTab.synth.ISynthOutput, 100);
    synth.loadSoundFont(bytes, false);
    this.synth = synth;
    this.tsf = (synth as unknown as { synthesizer: Tsf }).synthesizer;
    this.loadPresets();
  }

  private loadPresets() {
    const hydra = this.synth?.loadedSoundFonts?.[0];
    if (!hydra || !this.tsf) return;
    const keys = new Set<number>();
    for (let k = 24; k <= 90; k++) keys.add(k);
    this.tsf.loadPresets(hydra, this.programs.size ? this.programs : new Set([0]), keys, false);
  }

  private render(e: AudioProcessingEvent) {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    const frames = L.length;
    if (!this.tsf) {
      L.fill(0);
      R.fill(0);
      return;
    }
    const buf = new Float32Array(frames * 2);
    for (let pos = 0; pos < frames; pos += 64) this.tsf.synthesize(buf, pos * 2, Math.min(64, frames - pos));
    for (let i = 0; i < frames; i++) {
      L[i] = buf[i * 2];
      R[i] = buf[i * 2 + 1];
    }
  }

  /** Where live notes go: the strip of this track (resolved at each note), or the master. */
  target: () => AudioNode | null = () => null;
  private routed: AudioNode | null = null;
  private reroute() {
    if (!this.node || !this.ctx) return;
    const dest = this.target() ?? engine.graph.masterIn;
    if (dest === this.routed) return;
    try { this.node.disconnect(); } catch { /* none */ }
    this.node.connect(dest);
    this.routed = dest;
  }

  private async channelFor(program: number, percussion: boolean): Promise<{ tsf: Tsf; ch: number } | null> {
    const tsf = await this.ensure();
    if (!tsf) return null;
    this.reroute();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    if (!percussion && !this.programs.has(program)) {
      this.programs.add(program);
      this.loadPresets();
    }
    const ch = percussion ? 9 : 0;
    if (percussion) tsf.channelSetBank(ch, 128);
    tsf.channelSetPresetNumber(ch, percussion ? 0 : program, percussion);
    tsf.channelSetMixVolume(ch, 1);
    return { tsf, ch };
  }

  async noteOn(pitch: number, velocity: number, program: number, percussion = false) {
    const c = await this.channelFor(program, percussion);
    if (!c) return;
    c.tsf.channelNoteOff(c.ch, pitch);
    c.tsf.channelNoteOn(c.ch, pitch, Math.max(0.05, Math.min(1, velocity / 127)));
    this.held.set(pitch, c.ch);
    this.notesPlayed++;
  }

  noteOff(pitch: number) {
    const ch = this.held.get(pitch);
    if (ch === undefined || !this.tsf) return;
    this.tsf.channelNoteOff(ch, pitch);
    this.held.delete(pitch);
  }

  allOff() {
    this.tsf?.noteOffAll(false);
    this.held.clear();
  }

  /** Play notes together (strum = ms between notes) for `ms`, then release. */
  async playChord(pitches: number[], program: number, percussion = false, ms = 1400, strum = 25) {
    for (const p of pitches) this.noteOff(p);
    for (let i = 0; i < pitches.length; i++) {
      await this.noteOn(pitches[i], 96, program, percussion);
      if (strum) await new Promise((r) => setTimeout(r, strum));
    }
    setTimeout(() => pitches.forEach((p) => this.noteOff(p)), ms);
  }

  get name() {
    return this.soundFontName;
  }
}

export const liveSynth = new LiveSynth();
