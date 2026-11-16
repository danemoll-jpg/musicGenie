// The mixer as a Web Audio graph: one strip per track (effects -> fader -> pan -> mute/solo ->
// meter, plus Reverb/Delay sends), two send buses and the master (effects -> fader -> meter).
// The same class runs live (AudioContext) and offline (OfflineAudioContext) for export.
import { faderGain, songMix, trackGain, type Effect, type Song, type Track } from '../../../model';
import { buildEffect, type FxEnv, type FxNode } from './fx';

export interface Meter {
  peakL: number;
  peakR: number;
  /** Sticky until read with reset: any sample at or above full scale since the last reset. */
  clip: boolean;
}

class MeterTap {
  readonly split: ChannelSplitterNode;
  readonly l: AnalyserNode;
  readonly r: AnalyserNode;
  private buf = new Float32Array(2048);
  clip = false;
  constructor(ctx: BaseAudioContext, src: AudioNode) {
    this.split = ctx.createChannelSplitter(2);
    this.l = ctx.createAnalyser();
    this.r = ctx.createAnalyser();
    this.l.fftSize = this.r.fftSize = 2048;
    src.connect(this.split);
    this.split.connect(this.l, 0);
    this.split.connect(this.r, 1);
  }
  read(): Meter {
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.buf);
      let p = 0;
      for (const v of this.buf) p = Math.max(p, Math.abs(v));
      return p;
    };
    const peakL = peak(this.l);
    const peakR = peak(this.r);
    if (peakL >= 0.999 || peakR >= 0.999) this.clip = true;
    return { peakL, peakR, clip: this.clip };
  }
}

const fxSig = (fx: Effect[]) => fx.map((f) => f.id + ':' + f.type + ':' + (f.bypass ? 1 : 0)).join('|');

class Chain {
  nodes: FxNode[] = [];
  sig = '';
  constructor(private ctx: BaseAudioContext, private from: AudioNode, private to: AudioNode, private env: FxEnv) {
    from.connect(to);
  }
  /** Rebuild when the list/order/bypass changed; otherwise only update parameters. */
  sync(fx: Effect[], automated: Set<string> = new Set()) {
    const active = fx.filter((f) => !f.bypass);
    const sig = fxSig(fx);
    if (sig !== this.sig) {
      this.sig = sig;
      try { this.from.disconnect(); } catch { /* none */ }
      this.nodes.forEach((n) => n.dispose());
      this.nodes = active.map((f) => buildEffect(this.ctx, f, this.env));
      let prev: AudioNode = this.from;
      for (const n of this.nodes) { prev.connect(n.input); prev = n.output; }
      prev.connect(this.to);
      return;
    }
    for (const f of active) {
      const n = this.nodes.find((x) => x.id === f.id);
      if (!n) continue;
      for (const [k, v] of Object.entries(f.params)) if (!automated.has('fx:' + f.id + ':' + k)) n.set(k, v);
    }
  }
  node(id: string) {
    return this.nodes.find((n) => n.id === id);
  }
  dispose() {
    this.nodes.forEach((n) => n.dispose());
    try { this.from.disconnect(); } catch { /* none */ }
  }
}

export class Strip {
  readonly input: GainNode;
  private readonly fxOut: GainNode;
  readonly vol: GainNode;
  readonly pan: StereoPannerNode;
  readonly mute: GainNode;
  readonly sendR: GainNode;
  readonly sendD: GainNode;
  readonly meter: MeterTap;
  readonly chain: Chain;
  constructor(ctx: BaseAudioContext, readonly id: string, dest: AudioNode, reverb: AudioNode, delay: AudioNode, env: FxEnv) {
    this.input = ctx.createGain();
    this.fxOut = ctx.createGain();
    this.vol = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.mute = ctx.createGain();
    this.sendR = ctx.createGain();
    this.sendD = ctx.createGain();
    this.chain = new Chain(ctx, this.input, this.fxOut, env);
    this.fxOut.connect(this.vol).connect(this.pan).connect(this.mute).connect(dest);
    this.mute.connect(this.sendR).connect(reverb);
    this.mute.connect(this.sendD).connect(delay);
    this.meter = new MeterTap(ctx, this.mute);
  }
  /** Post-fader, post-mute output (stems tap here). */
  get out(): AudioNode {
    return this.mute;
  }
  dispose() {
    this.chain.dispose();
    for (const n of [this.input, this.fxOut, this.vol, this.pan, this.mute, this.sendR, this.sendD, this.meter.split]) {
      try { n.disconnect(); } catch { /* none */ }
    }
  }
}

class Bus {
  readonly input: GainNode;
  readonly vol: GainNode;
  readonly chain: Chain;
  readonly meter: MeterTap;
  private readonly fxOut: GainNode;
  constructor(ctx: BaseAudioContext, dest: AudioNode, env: FxEnv) {
    this.input = ctx.createGain();
    this.fxOut = ctx.createGain();
    this.vol = ctx.createGain();
    this.chain = new Chain(ctx, this.input, this.fxOut, env);
    this.fxOut.connect(this.vol).connect(dest);
    this.meter = new MeterTap(ctx, this.vol);
  }
}

export class MixGraph {
  readonly masterIn: GainNode;
  readonly masterVol: GainNode;
  readonly masterChain: Chain;
  readonly masterMeter: MeterTap;
  readonly reverb: Bus;
  readonly delay: Bus;
  /** Metronome / count-in: straight to the master fader (no effects). */
  readonly click: GainNode;
  readonly strips = new Map<string, Strip>();
  private masterFxOut: GainNode;
  song: Song | null = null;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, readonly env: FxEnv) {
    this.masterIn = ctx.createGain();
    this.masterFxOut = ctx.createGain();
    this.masterVol = ctx.createGain();
    this.masterChain = new Chain(ctx, this.masterIn, this.masterFxOut, env);
    this.masterFxOut.connect(this.masterVol).connect(dest);
    this.masterMeter = new MeterTap(ctx, this.masterVol);
    this.reverb = new Bus(ctx, this.masterIn, env);
    this.delay = new Bus(ctx, this.masterIn, env);
    this.click = ctx.createGain();
    this.click.connect(this.masterVol);
  }

  strip(trackId: string): Strip | undefined {
    return this.strips.get(trackId);
  }

  /** Bring the graph in line with the song's mixer (automated parameters are left to automation). */
  sync(song: Song, automated: (t: Track) => Set<string> = () => new Set()) {
    this.song = song;
    const ids = new Set(song.tracks.map((t) => t.id));
    for (const [id, s] of this.strips) if (!ids.has(id)) { s.dispose(); this.strips.delete(id); }
    const now = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, 0.01); };
    song.tracks.forEach((t, i) => {
      let s = this.strips.get(t.id);
      if (!s) {
        s = new Strip(this.ctx, t.id, this.masterIn, this.reverb.input, this.delay.input, this.env);
        this.strips.set(t.id, s);
      }
      const auto = automated(t);
      s.chain.sync(t.mixer.fx ?? [], auto);
      if (!auto.has('volume')) set(s.vol.gain, faderGain(t.mixer.volume));
      if (!auto.has('pan')) set(s.pan.pan, t.mixer.pan);
      set(s.mute.gain, trackGain(song, i) > 0 ? 1 : 0);
      set(s.sendR.gain, t.mixer.sends?.reverb ?? 0);
      set(s.sendD.gain, t.mixer.sends?.delay ?? 0);
    });
    const mix = songMix(song);
    this.masterChain.sync(mix.master.fx);
    set(this.masterVol.gain, faderGain(mix.master.volume));
    this.reverb.chain.sync([{ ...mix.reverb.fx, params: { ...mix.reverb.fx.params, mix: 1 } }]);
    this.delay.chain.sync([{ ...mix.delay.fx, params: { ...mix.delay.fx.params, mix: 1 } }]);
    set(this.reverb.vol.gain, mix.reverb.mute ? 0 : faderGain(mix.reverb.volume));
    set(this.delay.vol.gain, mix.delay.mute ? 0 : faderGain(mix.delay.volume));
  }

  /** Meter readings for every strip, the buses and the master. */
  meters(): { tracks: Record<string, Meter>; reverb: Meter; delay: Meter; master: Meter } {
    const tracks: Record<string, Meter> = {};
    for (const [id, s] of this.strips) tracks[id] = s.meter.read();
    return { tracks, reverb: this.reverb.meter.read(), delay: this.delay.meter.read(), master: this.masterMeter.read() };
  }

  resetClips() {
    for (const s of this.strips.values()) s.meter.clip = false;
    this.masterMeter.clip = false;
    this.reverb.meter.clip = this.delay.meter.clip = false;
  }

  /** The AudioParam (or effect parameter setter) behind an automation lane. */
  automationTarget(trackId: string, param: string): ((v: number, at: number, mode: 'smooth' | 'ramp' | 'set') => void) | null {
    const s = this.strips.get(trackId);
    if (!s) return null;
    const ap = (p: AudioParam, map: (v: number) => number) => (v: number, at: number, mode: 'smooth' | 'ramp' | 'set') => {
      if (mode === 'ramp') p.linearRampToValueAtTime(map(v), at);
      else if (mode === 'set') p.setValueAtTime(map(v), at);
      else { p.cancelScheduledValues(at); p.setTargetAtTime(map(v), at, 0.02); }
    };
    if (param === 'volume') return ap(s.vol.gain, faderGain);
    if (param === 'pan') return ap(s.pan.pan, (v) => v);
    if (param.startsWith('fx:')) {
      const [, id, key] = param.split(':');
      const n = s.chain.node(id);
      if (!n) return null;
      return (v, at, mode) => (mode === 'ramp' && n.ramp ? n.ramp(key, v, at) : n.set(key, v, at));
    }
    return null;
  }
}
