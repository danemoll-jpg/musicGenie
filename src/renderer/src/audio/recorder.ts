// Recording from an audio input (USB interface, Rocksmith Real Tone Cable, microphone...).
// Input -> mg-recorder worklet (captures, reports the level). Monitoring (off by default) sends the
// input to the armed track's strip. The recorded audio is placed by the player clock: every
// recorded sample has a context time, the worklet clock maps context time to the song, and the
// latency setting (measured with a loopback test) is subtracted.
import { engine } from './engine';
import { loadWorklets } from './worklet';

export interface RecorderState {
  devices: { id: string; name: string }[];
  deviceId: string | null;
  /** Peak of the input (0..1), updated ~20 times a second while the input is open. */
  level: number;
  open: boolean;
  monitor: boolean;
  recording: boolean;
  latencyMs: number;
  simulated: boolean;
  error: string | null;
}

export interface Take {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  /** Context frame of the first sample. */
  firstFrame: number;
}

export class AudioRecorder {
  state: RecorderState = { devices: [], deviceId: null, level: 0, open: false, monitor: false, recording: false, latencyMs: 0, simulated: false, error: null };
  private listeners = new Set<(s: RecorderState) => void>();
  private stream: MediaStream | null = null;
  private source: AudioNode | null = null;
  private node: AudioWorkletNode | null = null;
  private monitorGain: GainNode | null = null;
  private chunks: { L: Float32Array; R: Float32Array; firstFrame: number }[] = [];
  private stopped: (() => void) | null = null;
  private sink: GainNode | null = null;
  /** Test only: the simulated cable's delay line. */
  private simDelay: DelayNode | null = null;

  on(fn: (s: RecorderState) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private set(p: Partial<RecorderState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f(this.state));
  }
  setLatency(ms: number) {
    this.set({ latencyMs: Math.max(0, Math.min(1000, ms)) });
  }

  async refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const devices = list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || 'Input ' + (i + 1) }));
      this.set({ devices, error: null });
    } catch (e) {
      this.set({ error: 'Could not list audio inputs: ' + (e as Error).message });
    }
  }

  /** Open a real input device (null = the system default). */
  async openDevice(deviceId: string | null) {
    this.close();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      });
      this.stream = stream;
      await this.attach(engine.ctx.createMediaStreamSource(stream));
      this.set({ deviceId, simulated: false, error: null });
      void this.refreshDevices();
    } catch (e) {
      this.set({ error: 'Could not open the input: ' + (e as Error).message });
    }
  }

  /**
   * Test input: a simulated cable from the output (the metronome / test-click path, before the
   * master fader) back into the input, `delayMs` late. No real device or speaker is involved.
   */
  async openSimulated(delayMs: number) {
    this.close();
    const ctx = engine.ctx;
    const d = ctx.createDelay(2);
    d.delayTime.value = delayMs / 1000;
    engine.graph.click.connect(d);
    this.simDelay = d;
    await this.attach(d);
    this.set({ deviceId: 'simulated', simulated: true, error: null });
  }

  private async attach(src: AudioNode) {
    const ctx = engine.ctx;
    await loadWorklets(ctx);
    const node = new AudioWorkletNode(ctx, 'mg-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = (e) => {
      const d = e.data;
      if (d.cmd === 'level') this.set({ level: d.peak });
      else if (d.cmd === 'data') this.chunks.push({ L: d.L, R: d.R, firstFrame: d.firstFrame });
      else if (d.cmd === 'stopped') { this.stopped?.(); this.stopped = null; }
    };
    src.connect(node);
    // Keep the worklet running: its output goes nowhere audible.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    this.sink = sink;
    const mon = ctx.createGain();
    mon.gain.value = this.state.monitor ? 1 : 0;
    src.connect(mon);
    this.monitorGain = mon;
    this.source = src;
    this.node = node;
    this.set({ open: true });
  }

  /** Input monitoring: hear the input through a track's strip (its effects too). */
  setMonitor(on: boolean, trackId?: string | null) {
    const mon = this.monitorGain;
    if (mon) {
      try { mon.disconnect(); } catch { /* none */ }
      const strip = trackId ? engine.graph.strip(trackId) : undefined;
      if (on) mon.connect(strip ? strip.input : engine.graph.masterIn);
      mon.gain.value = on ? 1 : 0;
    }
    this.set({ monitor: on });
  }

  close() {
    for (const n of [this.source, this.node, this.monitorGain, this.sink, this.simDelay]) try { n?.disconnect(); } catch { /* none */ }
    if (this.simDelay) try { engine.graph.click.disconnect(this.simDelay); } catch { /* none */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = this.node = this.monitorGain = this.sink = this.simDelay = null;
    this.set({ open: false, level: 0 });
  }

  start() {
    if (!this.node) throw new Error('No audio input is open.');
    this.chunks = [];
    this.node.port.postMessage({ cmd: 'start' });
    this.set({ recording: true });
  }

  /** Stop and return what was captured. */
  async stop(): Promise<Take | null> {
    if (!this.node || !this.state.recording) return null;
    await new Promise<void>((r) => {
      this.stopped = r;
      this.node!.port.postMessage({ cmd: 'stop' });
      setTimeout(r, 1000);
    });
    this.set({ recording: false });
    const chunks = this.chunks.filter((c) => c.firstFrame >= 0);
    this.chunks = [];
    if (!chunks.length) return null;
    const n = chunks.reduce((a, c) => a + c.L.length, 0);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { L.set(c.L, o); R.set(c.R, o); o += c.L.length; }
    return { L, R, sampleRate: engine.ctx.sampleRate, firstFrame: chunks[0].firstFrame };
  }

  /**
   * Loopback latency test: play a click into the output and find it in the input. Connect the
   * interface's output to its input with a cable first (or use the simulated input in tests).
   */
  async measureLatency(): Promise<number | null> {
    if (!this.node) throw new Error('No audio input is open.');
    const ctx = engine.ctx;
    await ctx.resume();
    this.start();
    const buf = ctx.createBuffer(1, 64, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < 16; i++) d[i] = 0.9 * (1 - i / 16);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(engine.graph.click);
    const t0 = ctx.currentTime + 0.3;
    src.start(t0);
    await new Promise((r) => setTimeout(r, 1300));
    const take = await this.stop();
    if (!take) return null;
    let best = 0;
    let at = -1;
    for (let i = 0; i < take.L.length; i++) {
      const v = Math.max(Math.abs(take.L[i]), Math.abs(take.R[i]));
      if (v > best) { best = v; at = i; }
    }
    if (best < 0.02 || at < 0) return null;
    // The first sample above half the peak = the click's arrival.
    let first = at;
    while (first > 0 && Math.max(Math.abs(take.L[first - 1]), Math.abs(take.R[first - 1])) > best / 2) first--;
    const ms = ((take.firstFrame + first) / take.sampleRate - t0) * 1000;
    this.setLatency(Math.round(ms * 10) / 10);
    return this.state.latencyMs;
  }
}

export const recorder = new AudioRecorder();

/** Encode mono/stereo floats as a 16-bit WAV. */
export function takeToWav(L: Float32Array, R: Float32Array, sr: number): Uint8Array {
  const frames = L.length;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    v.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), true);
    v.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), true);
  }
  return new Uint8Array(buf);
}
