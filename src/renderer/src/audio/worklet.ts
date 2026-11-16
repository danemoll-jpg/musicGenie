// AudioWorklet processors, loaded from a Blob URL (no extra build step):
//  - mg-synth: plays the synthesizer's per-channel chunks; output N = MIDI channel N (16 = metronome),
//    so every track is a separate audio stream. Reports played frames back (the player clock).
//  - mg-gate: noise gate (envelope follower with hold).
//  - mg-recorder: captures its input (recording) and reports the input level.
export const WORKLET_SRC = /* js */ `
class MgSynth extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o.processorOptions;
    this.chunks = [];
    this.readPos = 0;
    this.queued = 0;
    this.requested = 0;
    this.capFrames = p.bufferFrames;
    this.chunkFrames = p.chunkFrames;
    this.reportFrames = p.reportFrames;
    this.playing = false;
    this.unreported = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }
  onMsg(d) {
    if (d.cmd === 'add') {
      this.requested = Math.max(0, this.requested - 1);
      if (d.frames > 0) { this.chunks.push(d); this.queued += d.frames; }
    } else if (d.cmd === 'reset') {
      this.report(true);
      this.chunks = []; this.queued = 0; this.readPos = 0;
    } else if (d.cmd === 'play') {
      this.playing = true; this.request();
    } else if (d.cmd === 'pause') {
      this.report(true);
      this.playing = false;
    }
  }
  report(force) {
    if (this.unreported > 0 && (force || this.unreported >= this.reportFrames)) {
      this.port.postMessage({ cmd: 'played', frames: this.unreported, time: currentTime, frame: currentFrame });
      this.unreported = 0;
    }
  }
  request() {
    if (!this.playing) return;
    const half = this.capFrames / 2;
    let k = 0;
    while (this.queued + (this.requested + k) * this.chunkFrames < half) k++;
    if (k > 0) {
      this.requested += k;
      this.port.postMessage({ cmd: 'request', count: k });
    }
  }
  process(_in, outputs) {
    const n = outputs[0][0].length;
    for (const o of outputs) for (const c of o) c.fill(0);
    if (!this.playing) return true;
    let w = 0;
    while (w < n && this.chunks.length) {
      const c = this.chunks[0];
      const take = Math.min(n - w, c.frames - this.readPos);
      for (let j = 0; j < c.chans.length; j++) {
        const ch = c.chans[j][0];
        const data = c.chans[j][1];
        const out = outputs[ch];
        if (!out) continue;
        const L = out[0], R = out[1];
        let s = this.readPos * 2;
        for (let i = 0; i < take; i++) { L[w + i] = data[s++]; R[w + i] = data[s++]; }
      }
      this.readPos += take;
      w += take;
      if (this.readPos >= c.frames) { this.chunks.shift(); this.readPos = 0; }
    }
    this.queued -= w;
    this.unreported += w;
    this.report(w < n);
    this.request();
    return true;
  }
}
registerProcessor('mg-synth', MgSynth);

class MgGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -120, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 1, minValue: 0.01, maxValue: 500, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 50, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.gain = 0; this.holdLeft = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const n = inp[0].length;
    const thr = Math.pow(10, p.threshold[0] / 20);
    const att = Math.exp(-1 / Math.max(1, p.attack[0] * sampleRate / 1000));
    const rel = Math.exp(-1 / Math.max(1, p.release[0] * sampleRate / 1000));
    const hold = p.hold[0] * sampleRate / 1000;
    const det = Math.exp(-1 / (0.005 * sampleRate));
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < inp.length; c++) peak = Math.max(peak, Math.abs(inp[c][i]));
      this.env = Math.max(peak, this.env * det);
      let target;
      if (this.env >= thr) { target = 1; this.holdLeft = hold; }
      else if (this.holdLeft > 0) { target = 1; this.holdLeft--; }
      else target = 0;
      this.gain = target > this.gain ? target + (this.gain - target) * att : target + (this.gain - target) * rel;
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ?? inp[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor('mg-gate', MgGate);

class MgRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buf = [];
    this.bufFrames = 0;
    this.peak = 0;
    this.meterFrames = 0;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'start') { this.recording = true; this.firstFrame = -1; }
      else if (e.data.cmd === 'stop') { this.flush(); this.recording = false; this.port.postMessage({ cmd: 'stopped' }); }
    };
  }
  flush() {
    if (!this.bufFrames) return;
    const L = new Float32Array(this.bufFrames), R = new Float32Array(this.bufFrames);
    let o = 0;
    for (const [l, r] of this.buf) { L.set(l, o); R.set(r, o); o += l.length; }
    this.port.postMessage({ cmd: 'data', L, R, firstFrame: this.firstFrame }, [L.buffer, R.buffer]);
    this.buf = []; this.bufFrames = 0; this.firstFrame = -1;
  }
  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const l = inp[0], r = inp[1] ?? inp[0];
      for (let i = 0; i < l.length; i++) this.peak = Math.max(this.peak, Math.abs(l[i]), Math.abs(r[i]));
      this.meterFrames += l.length;
      if (this.meterFrames >= 2048) { this.port.postMessage({ cmd: 'level', peak: this.peak }); this.peak = 0; this.meterFrames = 0; }
      if (this.recording) {
        if (this.firstFrame < 0) this.firstFrame = currentFrame;
        this.buf.push([l.slice(), r.slice()]);
        this.bufFrames += l.length;
        if (this.bufFrames >= sampleRate / 2) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('mg-recorder', MgRecorder);
`;

let url: string | null = null;
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Load the processors into a context (once per context). */
export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    url ??= URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url);
    loaded.set(ctx, p);
  }
  return p;
}
