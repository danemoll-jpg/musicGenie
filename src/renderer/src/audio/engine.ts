// Round 5 playback engine.
//
// alphaTab normally synthesises in a Web Worker and hands the page ONE stereo mix. For a mixer
// with per-track effects every track must be its own audio stream, so:
//  - alphaTab's own synthesizer (AlphaSynth + TinySoundFont) runs here on the page thread, created
//    through alphaTab's player factory, so the alphaTab API (cursor, loop/range, speed, count-in,
//    metronome, repeats, seeking, events) works exactly as before;
//  - its voice rendering is split per MIDI channel (each track owns its channel(s)), and an
//    AudioWorklet plays the channels on separate outputs, which feed the mixer graph (graph.ts);
//  - the worklet reports the frames it played back to alphaTab, so the cursor follows the audio.
// Offline export uses the same synthesizer and the same graph in an OfflineAudioContext.
import * as alphaTab from '@coderline/alphatab';
import { laneValueAt, lanePoints, type Song, type Track } from '../../../model';
import { MixGraph } from './graph';
import { loadWorklets } from './worklet';

export const OUTPUTS = 17; // MIDI channels 0..15 + the metronome channel (16)
const METRONOME = 16;
const BUFFER_MS = 1000;
/** Frames per synthesizer request (alphaTab: 32 micro buffers of 64 frames). */
const CHUNK_FRAMES = 64 * 32;

class Emitter<T = void> {
  private fns = new Set<(a: T) => void>();
  on(f: (a: T) => void) { this.fns.add(f); return () => { this.fns.delete(f); }; }
  off(f: (a: T) => void) { this.fns.delete(f); }
  trigger(a?: T) { for (const f of [...this.fns]) f(a as T); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tsf = any;
interface ChannelOut { src: Float32Array | null; chans: Map<number, Float32Array> }

/**
 * Make a TinySoundFont render every MIDI channel into its own buffer (same layout as the output
 * buffer); the output buffer still gets the full mix. Read the split with takeChannels().
 */
export function splitByChannel(tsf: Tsf) {
  if (tsf.mgSplit) return;
  tsf.mgSplit = true;
  tsf.mgOut = { src: null, chans: new Map() } as ChannelOut;
  tsf._fillWorkingBuffer = function (this: Tsf, buffer: Float32Array | null, pos: number, count: number) {
    const anySolo = this._isAnySolo;
    const processed: unknown[] = [];
    while (!this._midiEventQueue.isEmpty) {
      const m = this._midiEventQueue.dequeue();
      if (m.isMetronome && this.metronomeVolume > 0) {
        this.channelNoteOff(this._metronomeChannel, 33);
        this.channelNoteOn(this._metronomeChannel, 33, 95 / 127);
      } else if (m.event) this.processMidiMessage(m.event);
      processed.push(m);
    }
    const out: ChannelOut = this.mgOut;
    if (buffer && out.src !== buffer) { out.src = buffer; out.chans = new Map(); }
    for (const voice of this._voices) {
      if (voice.playingPreset === -1) continue;
      const ch = voice.playingChannel;
      const muted = this._mutedChannels.has(ch) || (anySolo && ch !== this._metronomeChannel && !this._soloChannels.has(ch));
      if (!buffer) { voice.kill(); continue; }
      let cb = out.chans.get(ch);
      if (!cb) { cb = new Float32Array(buffer.length); out.chans.set(ch, cb); }
      voice.render(this, cb, pos, count, muted);
    }
    if (buffer) {
      const end = pos + count * 2;
      for (const cb of out.chans.values()) for (let i = pos; i < end; i++) buffer[i] += cb[i];
    }
    return processed;
  };
}

/** The per-channel buffers that belong to `samples` (the last synthesised block), then forget them. */
export function takeChannels(tsf: Tsf, samples: Float32Array): [number, Float32Array][] {
  const out: ChannelOut = tsf.mgOut;
  if (!out?.src || (out.src !== samples && out.src.buffer !== samples.buffer)) return [];
  const list: [number, Float32Array][] = [];
  for (const [ch, buf] of out.chans) list.push([ch, buf.length === samples.length ? buf : buf.subarray(0, samples.length)]);
  out.src = null;
  out.chans = new Map();
  return list;
}

/** alphaTab ISynthOutput that feeds the multi-output worklet. */
class EngineOutput {
  readonly ready = new Emitter();
  readonly samplesPlayed = new Emitter<number>();
  readonly sampleRequest = new Emitter();
  tsf: Tsf = null;
  private node: AudioWorkletNode | null = null;
  private pending: { msg: unknown; transfer: Transferable[] }[] = [];
  constructor(private engine: Engine) {}
  get sampleRate() {
    return this.engine.ctx.sampleRate;
  }
  open(_bufferMs: number) {
    void this.engine.ensureNode().then((node) => {
      this.node = node;
      node.port.onmessage = (e) => this.onMessage(e.data);
      for (const p of this.pending) node.port.postMessage(p.msg, p.transfer);
      this.pending = [];
      this.ready.trigger();
    });
  }
  private post(msg: unknown, transfer: Transferable[] = []) {
    if (this.node) this.node.port.postMessage(msg, transfer);
    else this.pending.push({ msg, transfer });
  }
  private onMessage(d: { cmd: string; count?: number; frames?: number; time?: number }) {
    if (d.cmd === 'request') for (let i = 0; i < (d.count ?? 1); i++) this.sampleRequest.trigger();
    else if (d.cmd === 'played') {
      this.engine.notePlayed(d.frames!, d.time!);
      this.samplesPlayed.trigger(d.frames!);
    }
  }
  play() {
    void this.engine.ctx.resume();
    this.post({ cmd: 'play' });
  }
  pause() {
    this.post({ cmd: 'pause' });
  }
  destroy() {
    this.post({ cmd: 'pause' });
  }
  activate() {
    void this.engine.ctx.resume();
  }
  addSamples(samples: Float32Array) {
    const frames = samples.length / 2;
    const chans = frames > 0 && this.tsf ? takeChannels(this.tsf, samples) : [];
    this.engine.synthesizedFrames += frames;
    this.post({ cmd: 'add', frames, chans }, chans.map(([, b]) => b.buffer as ArrayBuffer).filter((b, i, a) => a.indexOf(b) === i));
  }
  resetSamples() {
    this.post({ cmd: 'reset' });
  }
  async enumerateOutputDevices() { return []; }
  async setOutputDevice() {}
  async getOutputDevice() { return null; }
}

export interface PlayClock {
  /** Context time of the last played-frames report, and the synth time (ms) at that moment. */
  ctxTime: number;
  synthMs: number;
}

export class Engine {
  readonly ctx: AudioContext;
  readonly graph: MixGraph;
  synth: alphaTab.synth.AlphaSynth | null = null;
  private output: EngineOutput | null = null;
  private node: AudioWorkletNode | null = null;
  private nodePromise: Promise<AudioWorkletNode> | null = null;
  /** Per model track: the MIDI channels it plays on. */
  channelMap: number[][] = [];
  private routedSig = '';
  synthesizedFrames = 0;
  playedFrames = 0;
  clock: PlayClock = { ctxTime: 0, synthMs: 0 };
  /** Set by the player: playback tick -> model tick (repeats folded back). */
  modelTick: (playTick: number) => number = (t) => t;
  private song: Song | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private lanes: { track: Track; param: string; pts: { t: number; v: number }[] }[] = [];

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    let bpm = 120;
    this.graph = new MixGraph(this.ctx, this.ctx.destination, { bpm: () => bpm });
    this.bpmRef = (v) => { bpm = v; };
  }
  private bpmRef: (v: number) => void;

  ensureNode(): Promise<AudioWorkletNode> {
    if (!this.nodePromise) {
      this.nodePromise = loadWorklets(this.ctx).then(() => {
        const node = new AudioWorkletNode(this.ctx, 'mg-synth', {
          numberOfInputs: 0,
          numberOfOutputs: OUTPUTS,
          outputChannelCount: Array(OUTPUTS).fill(2),
          processorOptions: {
            bufferFrames: Math.round((BUFFER_MS / 1000) * this.ctx.sampleRate),
            chunkFrames: CHUNK_FRAMES,
            reportFrames: Math.round(0.03 * this.ctx.sampleRate),
          },
        });
        this.node = node;
        this.routedSig = '';
        if (this.song) this.route(this.song, this.channelMap);
        return node;
      });
    }
    return this.nodePromise;
  }

  /** alphaTab's player factory: a page-thread AlphaSynth on our output. */
  createSynth(): alphaTab.synth.AlphaSynth {
    const out = new EngineOutput(this);
    const synth = new alphaTab.synth.AlphaSynth(out as unknown as alphaTab.synth.ISynthOutput, BUFFER_MS);
    const tsf = (synth as unknown as { synthesizer: Tsf }).synthesizer;
    splitByChannel(tsf);
    out.tsf = tsf;
    this.output = out;
    this.synth = synth;
    return synth;
  }

  notePlayed(frames: number, ctxTime: number) {
    this.playedFrames += frames;
    const s = this.synth;
    // The synth adds these frames to its time position right after this call.
    this.clock = { ctxTime: ctxTime + 128 / this.ctx.sampleRate, synthMs: (s?.timePosition ?? 0) + (frames / this.ctx.sampleRate) * 1000 };
  }

  /** Synth time (ms, playback timeline) heard at a context time. */
  synthMsAt(ctxTime: number): number {
    const playing = this.synth?.state === 1;
    if (!playing) return this.synth?.timePosition ?? 0;
    return this.clock.synthMs + (ctxTime - this.clock.ctxTime) * 1000;
  }

  get playingMain(): boolean {
    const s = this.synth as unknown as { state: number; sequencer?: { isPlayingMain: boolean } } | null;
    return !!s && s.state === 1 && !!s.sequencer?.isPlayingMain;
  }

  playTickAtMs(ms: number): number {
    const seq = (this.synth as unknown as { sequencer: { currentTimePositionToTickPosition(ms: number): number } } | null)?.sequencer;
    return seq ? seq.currentTimePositionToTickPosition(ms) : 0;
  }
  msAtPlayTick(tick: number): number {
    const seq = (this.synth as unknown as { sequencer: { mainTickPositionToTimePosition(t: number): number } } | null)?.sequencer;
    return seq ? seq.mainTickPositionToTimePosition(tick) : 0;
  }

  /** Mixer state (and channel routing) from the song. */
  setSong(song: Song, channelMap: number[][] | null) {
    this.song = song;
    if (channelMap) this.channelMap = channelMap;
    this.bpmRef(song.tempos[0]?.bpm ?? 120);
    this.lanes = [];
    for (const t of song.tracks) for (const l of t.automation ?? []) if (l.points.length) this.lanes.push({ track: t, param: l.param, pts: lanePoints(song, l) });
    this.graph.sync(song, (t) => new Set((t.automation ?? []).filter((l) => l.points.length).map((l) => l.param)));
    this.route(song, this.channelMap);
    this.applyAutomation(true);
    if (this.lanes.length && !this.autoTimer) this.autoTimer = setInterval(() => this.applyAutomation(false), 25);
    if (!this.lanes.length && this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; }
  }

  /** Connect worklet outputs (MIDI channels) to the tracks' strips. */
  private route(song: Song, map: number[][]) {
    const node = this.node;
    if (!node) return;
    const owner = new Map<number, string>();
    map.forEach((chs, i) => {
      const t = song.tracks[i];
      if (!t || t.audio) return;
      for (const ch of chs) if (!owner.has(ch)) owner.set(ch, t.id);
    });
    const sig = [...owner].map(([c, id]) => c + '=' + id).join(',') + '|' + [...this.graph.strips.keys()].join(',');
    if (sig === this.routedSig) return;
    this.routedSig = sig;
    try { node.disconnect(); } catch { /* none */ }
    for (let ch = 0; ch < OUTPUTS; ch++) {
      if (ch === METRONOME) { node.connect(this.graph.click, ch, 0); continue; }
      const id = owner.get(ch);
      const strip = id ? this.graph.strip(id) : undefined;
      node.connect(strip ? strip.input : this.graph.masterIn, ch, 0);
    }
  }

  /** Live automation: follow the heard position (works through loops, repeats and seeks). */
  private applyAutomation(force: boolean) {
    if (!this.lanes.length || !this.song) return;
    if (!force && this.synth?.state !== 1) return;
    const now = this.ctx.currentTime;
    const ms = this.synthMsAt(now);
    const tick = this.playingMain || force ? this.modelTick(this.playTickAtMs(ms)) : 0;
    for (const l of this.lanes) {
      const v = laneValueAt(l.pts, tick);
      if (v === undefined) continue;
      this.graph.automationTarget(l.track.id, l.param)?.(v, now, 'smooth');
    }
  }

  /** Peak levels per track strip / bus / master (post-fader, post-mute). */
  meters() {
    return this.graph.meters();
  }
}

export const engine = new Engine();
