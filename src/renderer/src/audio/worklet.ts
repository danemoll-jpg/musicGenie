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
  constructor() { super(); this.env = 0; this.gain = 0; this.holdLeft = 0; this.port.onmessage = (e) => { if (e.data === 'stop') this.dead = true; }; }
  process(inputs, outputs, p) {
    if (this.dead) return false;
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

// Feed-forward compressor (soft knee, attack/release on the gain reduction, makeup). Unlike the
// built-in DynamicsCompressorNode it adds no automatic makeup gain: below the threshold = untouched.
class MgComp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -18, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 100, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, minValue: 0.01, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 150, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: -24, maxValue: 48, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.port.onmessage = (e) => { if (e.data === 'stop') this.dead = true; }; }
  process(inputs, outputs, p) {
    if (this.dead) return false;
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const n = inp[0].length;
    const T = p.threshold[0], R = p.ratio[0], K = p.knee[0];
    const aA = Math.exp(-1 / Math.max(1, p.attack[0] * sampleRate / 1000));
    const aR = Math.exp(-1 / Math.max(1, p.release[0] * sampleRate / 1000));
    const mk = p.makeup[0];
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let c = 0; c < inp.length; c++) x = Math.max(x, Math.abs(inp[c][i]));
      const xd = 20 * Math.log10(x + 1e-12);
      const d = xd - T;
      let y;
      if (2 * d < -K) y = xd;
      else if (K > 0 && 2 * Math.abs(d) <= K) y = xd + ((1 / R - 1) * (d + K / 2) * (d + K / 2)) / (2 * K);
      else y = T + d / R;
      const gr = y - xd;
      this.env = gr < this.env ? aA * this.env + (1 - aA) * gr : aR * this.env + (1 - aR) * gr;
      const g = Math.pow(10, (this.env + mk) / 20);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ?? inp[0])[i] * g;
    }
    return true;
  }
}
registerProcessor('mg-comp', MgComp);

// Look-ahead peak limiter (5 ms): the gain is lowered smoothly before a peak arrives, so the output
// never goes over the ceiling; recovers with the release time.
class MgLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -1, minValue: -40, maxValue: 0, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: -24, maxValue: 36, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 80, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.L = Math.max(1, Math.round(0.005 * sampleRate));
    this.size = this.L + 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.need = new Float32Array(this.size);
    this.envRing = new Float32Array(this.L);
    this.envRing.fill(1);
    this.envSum = this.L;
    this.pos = 0;
    this.epos = 0;
    this.g = 1;
    this.dqI = new Float64Array(this.size * 2);
    this.dqV = new Float32Array(this.size * 2);
    this.h = 0; this.t = 0; this.count = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.dead = true; };
  }
  process(inputs, outputs, p) {
    if (this.dead) return false;
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length;
    const ceil = Math.pow(10, p.ceiling[0] / 20);
    const ig = Math.pow(10, p.gain[0] / 20);
    const rel = Math.exp(-1 / Math.max(1, p.release[0] * sampleRate / 1000));
    const L = this.L, size = this.size, cap = this.dqI.length;
    for (let i = 0; i < n; i++) {
      const l = inp.length ? inp[0][i] * ig : 0;
      const r = inp.length ? (inp[1] ?? inp[0])[i] * ig : 0;
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const nd = pk > ceil ? ceil / pk : 1;
      const k = this.count++;
      // Sliding minimum of the needed gain over the last L+1 samples (monotonic deque).
      while (this.t > this.h && this.dqV[(this.t - 1) % cap] >= nd) this.t--;
      this.dqI[this.t % cap] = k; this.dqV[this.t % cap] = nd; this.t++;
      while (this.dqI[this.h % cap] <= k - size) this.h++;
      const smin = this.dqV[this.h % cap];
      this.g = Math.min(smin, 1 - (1 - this.g) * rel);
      // Moving average over L samples, applied to the sample that is L old.
      this.envSum += this.g - this.envRing[this.epos];
      this.envRing[this.epos] = this.g;
      this.epos = (this.epos + 1) % L;
      const wp = this.pos;
      this.bufL[wp] = l; this.bufR[wp] = r; this.need[wp] = nd;
      const rp = (wp + 1) % size;
      const gain = Math.min(this.envSum / L, this.need[rp]);
      out[0][i] = this.bufL[rp] * gain;
      if (out[1]) out[1][i] = this.bufR[rp] * gain;
      this.pos = rp;
    }
    return true;
  }
}
registerProcessor('mg-limiter', MgLimiter);

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
