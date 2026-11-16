// Master bus: every Web Audio node that connects to a context's speakers is routed through
//   pre-analyser -> master gain -> post-analyser -> destination.
// Installed before any other code runs (first import in main.tsx), so with --mute the
// master gain is 0 from the very first audio node, and the post-analyser proves it.

type Bus = { ctx: BaseAudioContext; pre: AnalyserNode; gain: GainNode; post: AnalyserNode };

const buses: Bus[] = [];
let masterGain = window.mg?.flags.mute ? 0 : 1;

const origConnect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
const origDisconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...args: unknown[]) => unknown;

function busFor(ctx: BaseAudioContext): Bus {
  let bus = buses.find((b) => b.ctx === ctx);
  if (bus) return bus;
  const pre = ctx.createAnalyser();
  const gain = ctx.createGain();
  const post = ctx.createAnalyser();
  pre.fftSize = post.fftSize = 2048;
  gain.gain.value = masterGain;
  origConnect.call(pre, gain);
  origConnect.call(gain, post);
  origConnect.call(post, ctx.destination);
  bus = { ctx, pre, gain, post };
  buses.push(bus);
  return bus;
}

AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
  if (dest instanceof AudioDestinationNode) {
    origConnect.call(this, busFor(dest.context).pre, ...rest);
    return dest;
  }
  return origConnect.call(this, dest, ...rest);
} as typeof AudioNode.prototype.connect;

AudioNode.prototype.disconnect = function (this: AudioNode, dest?: unknown, ...rest: unknown[]) {
  if (dest instanceof AudioDestinationNode) {
    const bus = buses.find((b) => b.ctx === dest.context);
    if (bus) return origDisconnect.call(this, bus.pre, ...rest);
  }
  return origDisconnect.call(this, ...(dest === undefined ? [] : [dest]), ...rest);
} as typeof AudioNode.prototype.disconnect;

export function setMasterGain(value: number) {
  masterGain = Math.max(0, Math.min(1, value));
  for (const b of buses) b.gain.gain.value = masterGain;
}

export function getMasterGain() {
  return masterGain;
}

export interface LevelReport {
  /** Number of audio contexts routed through the bus. */
  contexts: number;
  /** Peak absolute sample before the master gain (proves audio was being produced). */
  prePeak: number;
  /** Peak absolute sample after the master gain = what reaches the speakers. */
  postPeak: number;
  masterGain: number;
  durationMs: number;
}

/** Sample the analysers for `ms` milliseconds and report peak levels. */
export function measureLevels(ms: number): Promise<LevelReport> {
  return new Promise((resolve) => {
    let prePeak = 0;
    let postPeak = 0;
    const buf = new Float32Array(2048);
    const sample = () => {
      for (const b of buses) {
        b.pre.getFloatTimeDomainData(buf);
        for (const v of buf) prePeak = Math.max(prePeak, Math.abs(v));
        b.post.getFloatTimeDomainData(buf);
        for (const v of buf) postPeak = Math.max(postPeak, Math.abs(v));
      }
    };
    const start = performance.now();
    const id = setInterval(sample, 10);
    setTimeout(() => {
      clearInterval(id);
      sample();
      resolve({ contexts: buses.length, prePeak, postPeak, masterGain, durationMs: Math.round(performance.now() - start) });
    }, ms);
  });
}
