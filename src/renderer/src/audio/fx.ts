// Effects as Web Audio node chains (live and offline contexts alike). Impulse responses for the
// reverbs and speaker cabinets are generated here from a fixed seed (made by musicGenie, so no
// third-party licence applies), the same every run.
import { dbToGain, delaySeconds, type Effect, type FxType } from '../../../model';

export interface FxEnv {
  /** Tempo for synced delays (quarter notes per minute). */
  bpm: () => number;
}

export interface FxNode {
  id: string;
  type: FxType;
  input: AudioNode;
  output: AudioNode;
  /** Change a parameter; `at` = context time (default now), smoothed. */
  set(key: string, value: number, at?: number): void;
  /** Ramp a parameter linearly to a value at a context time (offline automation). */
  ramp?(key: string, value: number, at: number): void;
  dispose(): void;
}

// ------------------------------------------------------------------ deterministic IRs

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296 * 2 - 1;
  };
}

interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number }
function bq(type: 'lp' | 'hp' | 'peak' | 'ls' | 'hs', f: number, q: number, gainDb: number, sr: number): Bq {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else {
    const sq = 2 * Math.sqrt(A) * al;
    if (type === 'ls') {
      b0 = A * ((A + 1) - (A - 1) * cw + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sq);
      a0 = (A + 1) + (A - 1) * cw + sq; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sq;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sq);
      a0 = (A + 1) - (A - 1) * cw + sq; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function runBq(x: Float32Array, f: Bq) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
}

const irCache = new Map<string, Float32Array[]>();

/** Reverb IR: 0 room, 1 hall, 2 plate; `decay` = RT60 in seconds. */
export function reverbIR(type: number, decay: number, sr: number): Float32Array[] {
  const key = `rev:${type}:${decay.toFixed(2)}:${sr}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.round(sr * Math.min(10, decay * 1.15 + 0.05)));
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(1234 + type * 97 + ch * 31);
    const d = new Float32Array(len);
    const k = 6.91 / (decay * sr); // -60 dB at `decay`
    for (let i = 0; i < len; i++) d[i] = r() * Math.exp(-k * i);
    // Early reflections (room / hall): a few discrete taps.
    if (type !== 2) {
      const taps = type === 0 ? [7, 11, 17, 23, 29, 37] : [19, 29, 41, 53, 67, 83];
      taps.forEach((ms, j) => {
        const at = Math.round(((ms + ch * 1.7) / 1000) * sr);
        if (at < len) d[at] += (0.7 - j * 0.08) * (r() > 0 ? 1 : -1);
      });
    }
    // Darker as it decays (air absorption): plate stays brighter.
    runBq(d, bq('lp', type === 2 ? 9000 : type === 1 ? 6000 : 7000, 0.7, 0, sr));
    runBq(d, bq('hp', type === 2 ? 200 : 120, 0.7, 0, sr));
    // Fade in over 2 ms so there is no click at the start.
    const fi = Math.round(0.002 * sr);
    for (let i = 0; i < Math.min(fi, len); i++) d[i] *= i / fi;
    out.push(d);
  }
  irCache.set(key, out);
  return out;
}

/** Speaker cabinet IR (see CAB_TYPES): 0 4x12 closed, 1 2x12 open, 2 1x12 combo, 3 bass 8x10, 4 bass 1x15. */
export function cabinetIR(cab: number, sr: number): Float32Array[] {
  const key = `cab:${cab}:${sr}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const len = Math.round(sr * 0.04);
  const shapes: ['lp' | 'hp' | 'peak' | 'ls' | 'hs', number, number, number][][] = [
    [['hp', 75, 0.8, 0], ['peak', 110, 1.2, 5], ['peak', 400, 1, -3], ['peak', 2500, 1.4, 5], ['lp', 4800, 0.9, 0], ['lp', 5500, 0.7, 0]],
    [['hp', 90, 0.7, 0], ['peak', 130, 1, 2], ['peak', 3000, 1.2, 4], ['lp', 6500, 0.8, 0], ['lp', 7500, 0.7, 0]],
    [['hp', 100, 0.7, 0], ['peak', 150, 1, 3], ['peak', 2200, 1.3, 4], ['lp', 5500, 0.8, 0], ['lp', 6000, 0.7, 0]],
    [['hp', 45, 0.8, 0], ['peak', 80, 1, 4], ['peak', 800, 1, 2], ['lp', 3500, 0.8, 0], ['lp', 4000, 0.7, 0]],
    [['hp', 35, 0.8, 0], ['peak', 60, 1, 5], ['peak', 600, 1, -2], ['lp', 2500, 0.8, 0], ['lp', 3000, 0.7, 0]],
  ];
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(777 + cab * 13 + ch);
    const d = new Float32Array(len);
    d[0] = 1;
    for (let i = 1; i < len; i++) d[i] = r() * 0.08 * Math.exp(-i / (0.002 * sr));
    for (const [t, f, q, g] of shapes[Math.max(0, Math.min(4, Math.round(cab)))]) runBq(d, bq(t, f, q, g, sr));
    // Normalise to unity gain around the cabinet's sweet spot.
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < len; i++) d[i] *= k * 0.5;
    out.push(d);
  }
  irCache.set(key, out);
  return out;
}

function irBuffer(ctx: BaseAudioContext, chans: Float32Array[]): AudioBuffer {
  const b = ctx.createBuffer(chans.length, chans[0].length, ctx.sampleRate);
  chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

// ------------------------------------------------------------------ shaping curves

const curveCache = new Map<string, Float32Array>();
/** 0 overdrive (soft, tanh), 1 distortion (harder), 2 fuzz (asymmetric, square-ish), 3 amp (tube-like asymmetric). */
function shaperCurve(mode: number): Float32Array<ArrayBuffer> {
  const key = 'm' + mode;
  let c = curveCache.get(key);
  if (!c) {
    const n = 4096;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      let y: number;
      if (mode === 0) y = Math.tanh(1.5 * x) / Math.tanh(1.5);
      else if (mode === 1) y = Math.atan(6 * x) / Math.atan(6);
      else if (mode === 2) y = Math.sign(x) * (1 - Math.exp(-8 * Math.abs(x + 0.08 * x * x)));
      else y = x >= 0 ? Math.tanh(2 * x) / Math.tanh(2) : Math.tanh(1.4 * x) / Math.tanh(1.4);
      c[i] = y;
    }
    curveCache.set(key, c);
  }
  return c as Float32Array<ArrayBuffer>;
}

function limiterCurve(ceilDb: number): Float32Array<ArrayBuffer> {
  const key = 'lim' + ceilDb.toFixed(2);
  let c = curveCache.get(key);
  if (!c) {
    const ceil = dbToGain(ceilDb);
    const knee = 0.85 * ceil;
    const n = 8192;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
      c[i] = Math.sign(x) * Math.min(ceil, y);
    }
    curveCache.set(key, c);
  }
  return c as Float32Array<ArrayBuffer>;
}

// ------------------------------------------------------------------ builders

const smooth = (p: AudioParam, v: number, at: number) => {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(v, at, 0.015);
};

/** Build one effect. Unknown params are ignored. */
export function buildEffect(ctx: BaseAudioContext, fx: Effect, env: FxEnv): FxNode {
  const p = fx.params;
  const now = () => ctx.currentTime;
  const nodes: AudioNode[] = [];
  const mk = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  const gain = (v = 1) => { const g = mk(ctx.createGain()); g.gain.value = v; return g; };
  const filt = (type: BiquadFilterType, f: number, q = 0.707, g = 0) => {
    const b = mk(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b;
  };
  const lfo = (rate: number) => { const o = mk(ctx.createOscillator()); o.frequency.value = rate; o.start(); return o; };
  const params: Record<string, (v: number, at: number, ramp: boolean) => void> = {};
  const param = (ap: AudioParam, map: (v: number) => number = (v) => v) => (v: number, at: number, ramp: boolean) =>
    ramp ? ap.linearRampToValueAtTime(map(v), at) : smooth(ap, map(v), at);
  let input: AudioNode;
  let output: AudioNode;
  const dryWet = (src: AudioNode, wetPath: AudioNode, wetOut: AudioNode, mix: number) => {
    const dry = gain(1 - mix);
    const wet = gain(mix);
    const out = gain(1);
    src.connect(dry).connect(out);
    src.connect(wetPath);
    wetOut.connect(wet).connect(out);
    params.mix = (v, at, r) => { param(dry.gain)(1 - v, at, r); param(wet.gain)(v, at, r); };
    return out;
  };

  switch (fx.type) {
    case 'eq3': {
      const lo = filt('lowshelf', p.lowFreq, 0.707, p.low);
      const mid = filt('peaking', p.midFreq, 0.9, p.mid);
      const hi = filt('highshelf', p.highFreq, 0.707, p.high);
      lo.connect(mid).connect(hi);
      input = lo; output = hi;
      params.low = param(lo.gain); params.lowFreq = param(lo.frequency);
      params.mid = param(mid.gain); params.midFreq = param(mid.frequency);
      params.high = param(hi.gain); params.highFreq = param(hi.frequency);
      break;
    }
    case 'peq': {
      const lc = filt('highpass', p.lowCut, 0.707);
      const hc = filt('lowpass', p.highCut, 0.707);
      const b1 = filt('peaking', p.freq, p.q, p.gain);
      const b2 = filt('peaking', p.freq2, p.q2, p.gain2);
      lc.connect(hc).connect(b1).connect(b2);
      input = lc; output = b2;
      Object.assign(params, {
        lowCut: param(lc.frequency), highCut: param(hc.frequency), freq: param(b1.frequency), gain: param(b1.gain), q: param(b1.Q),
        freq2: param(b2.frequency), gain2: param(b2.gain), q2: param(b2.Q),
      });
      break;
    }
    case 'comp': {
      const c = mk(ctx.createDynamicsCompressor());
      c.threshold.value = p.threshold; c.ratio.value = p.ratio; c.attack.value = p.attack / 1000;
      c.release.value = p.release / 1000; c.knee.value = p.knee;
      const mg = gain(dbToGain(p.makeup));
      c.connect(mg);
      input = c; output = mg;
      Object.assign(params, {
        threshold: param(c.threshold), ratio: param(c.ratio), attack: param(c.attack, (v) => v / 1000),
        release: param(c.release, (v) => v / 1000), knee: param(c.knee), makeup: param(mg.gain, dbToGain),
      });
      break;
    }
    case 'gate': {
      const g = mk(new AudioWorkletNode(ctx, 'mg-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }));
      const ap = (k: string) => g.parameters.get(k)!;
      for (const k of ['threshold', 'attack', 'hold', 'release']) { ap(k).value = p[k]; params[k] = param(ap(k)); }
      input = g; output = g;
      break;
    }
    case 'drive': {
      const pre = gain(dbToGain(p.drive * 36));
      const sh = mk(ctx.createWaveShaper());
      sh.curve = shaperCurve(Math.round(p.mode));
      sh.oversample = '4x';
      const tone = filt('lowpass', p.tone, 0.707);
      const lvl = gain(dbToGain(p.level));
      pre.connect(sh).connect(tone).connect(lvl);
      input = pre; output = lvl;
      params.drive = param(pre.gain, (v) => dbToGain(v * 36));
      params.tone = param(tone.frequency);
      params.level = param(lvl.gain, dbToGain);
      params.mode = (v) => { sh.curve = shaperCurve(Math.round(v)); };
      break;
    }
    case 'amp':
    case 'bassamp': {
      const bassAmp = fx.type === 'bassamp';
      const inG = gain(1);
      const hp = filt('highpass', bassAmp ? 30 : 80, 0.707);
      const pre = gain(dbToGain(p.gain * 40));
      const sh = mk(ctx.createWaveShaper());
      sh.curve = shaperCurve(3);
      sh.oversample = '4x';
      const post = gain(dbToGain(-p.gain * 18)); // keep the level roughly steady as gain rises
      const bass = filt('lowshelf', bassAmp ? 80 : 120, 0.707, p.bass);
      const mid = filt('peaking', bassAmp ? 500 : 700, 0.8, p.mid);
      const treb = filt('highshelf', bassAmp ? 2500 : 3200, 0.707, p.treble);
      const pres = filt('peaking', 4500, 1, bassAmp ? 0 : p.presence ?? 0);
      const cab = mk(ctx.createConvolver());
      cab.normalize = false;
      cab.buffer = irBuffer(ctx, cabinetIR(p.cab, ctx.sampleRate));
      const lvl = gain(dbToGain(p.level));
      inG.connect(hp).connect(pre).connect(sh).connect(post).connect(bass).connect(mid).connect(treb).connect(pres).connect(cab);
      if (bassAmp) {
        const di = gain(p.blend);
        const ampOut = gain(1 - p.blend);
        inG.connect(di).connect(lvl);
        cab.connect(ampOut).connect(lvl);
        params.blend = (v, at, r) => { param(di.gain)(v, at, r); param(ampOut.gain)(1 - v, at, r); };
      } else cab.connect(lvl);
      input = inG; output = lvl;
      params.gain = (v, at, r) => { param(pre.gain, (x) => dbToGain(x * 40))(v, at, r); param(post.gain, (x) => dbToGain(-x * 18))(v, at, r); };
      params.bass = param(bass.gain); params.mid = param(mid.gain); params.treble = param(treb.gain);
      params.presence = param(pres.gain); params.level = param(lvl.gain, dbToGain);
      params.cab = (v) => { cab.buffer = irBuffer(ctx, cabinetIR(v, ctx.sampleRate)); };
      break;
    }
    case 'chorus':
    case 'flanger': {
      const fl = fx.type === 'flanger';
      const inG = gain(1);
      const d = mk(ctx.createDelay(0.1));
      const base = fl ? 0.003 : 0.018;
      d.delayTime.value = base;
      const osc = lfo(p.rate);
      const depth = gain(p.depth * (fl ? 0.0025 : 0.006));
      osc.connect(depth).connect(d.delayTime);
      inG.connect(d);
      if (fl) {
        const fb = gain(p.feedback);
        d.connect(fb).connect(d);
        params.feedback = param(fb.gain);
      }
      output = dryWet(inG, d, d, p.mix);
      input = inG;
      params.rate = param(osc.frequency);
      params.depth = param(depth.gain, (v) => v * (fl ? 0.0025 : 0.006));
      break;
    }
    case 'phaser': {
      const inG = gain(1);
      const stages = [0, 1, 2, 3].map(() => filt('allpass', 800, 0.5));
      const osc = lfo(p.rate);
      const depth = gain(p.depth * 700);
      const fbIn = gain(1);
      inG.connect(fbIn);
      let prev: AudioNode = fbIn;
      for (const s of stages) { osc.connect(depth); depth.connect(s.frequency); prev.connect(s); prev = s; }
      const fb = gain(p.feedback);
      prev.connect(fb).connect(fbIn);
      output = dryWet(inG, fbIn, prev, p.mix);
      input = inG;
      params.rate = param(osc.frequency);
      params.depth = param(depth.gain, (v) => v * 700);
      params.feedback = param(fb.gain);
      break;
    }
    case 'tremolo': {
      const g = gain(1 - p.depth / 2);
      const osc = lfo(p.rate);
      const depth = gain(p.depth / 2);
      osc.connect(depth).connect(g.gain);
      input = g; output = g;
      params.rate = param(osc.frequency);
      params.depth = (v, at, r) => { param(g.gain)(1 - v / 2, at, r); param(depth.gain)(v / 2, at, r); };
      break;
    }
    case 'delay': {
      const inG = gain(1);
      const d = mk(ctx.createDelay(5));
      d.delayTime.value = delaySeconds(p.note, env.bpm());
      const tone = filt('lowpass', p.tone, 0.707);
      const fb = gain(p.feedback);
      inG.connect(d);
      d.connect(tone).connect(fb).connect(d);
      output = dryWet(inG, d, tone, p.mix);
      input = inG;
      params.note = (v, at) => smooth(d.delayTime, delaySeconds(v, env.bpm()), at);
      params.feedback = param(fb.gain);
      params.tone = param(tone.frequency);
      break;
    }
    case 'reverb': {
      const inG = gain(1);
      const pre = mk(ctx.createDelay(1));
      pre.delayTime.value = p.predelay / 1000;
      const conv = mk(ctx.createConvolver());
      conv.normalize = true;
      conv.buffer = irBuffer(ctx, reverbIR(Math.round(p.type), p.decay, ctx.sampleRate));
      inG.connect(pre).connect(conv);
      output = dryWet(inG, pre, conv, p.mix);
      input = inG;
      params.predelay = param(pre.delayTime, (v) => v / 1000);
      const reIR = () => { conv.buffer = irBuffer(ctx, reverbIR(Math.round(cur.type), cur.decay, ctx.sampleRate)); };
      const cur = { type: p.type, decay: p.decay };
      params.type = (v) => { cur.type = v; reIR(); };
      params.decay = (v) => { cur.decay = v; reIR(); };
      break;
    }
    case 'limiter': {
      const inG = gain(dbToGain(p.gain));
      const c = mk(ctx.createDynamicsCompressor());
      c.threshold.value = p.ceiling - 3; c.ratio.value = 20; c.knee.value = 0; c.attack.value = 0.001; c.release.value = p.release / 1000;
      const sh = mk(ctx.createWaveShaper());
      sh.curve = limiterCurve(p.ceiling);
      inG.connect(c).connect(sh);
      input = inG; output = sh;
      params.gain = param(inG.gain, dbToGain);
      params.release = param(c.release, (v) => v / 1000);
      params.ceiling = (v, at) => { smooth(c.threshold, v - 3, at); sh.curve = limiterCurve(v); };
      break;
    }
    default: {
      const g = gain(1);
      input = g; output = g;
    }
  }

  return {
    id: fx.id,
    type: fx.type,
    input: input!,
    output: output!,
    set(key, value, at) {
      params[key]?.(value, at ?? now(), false);
    },
    ramp(key, value, at) {
      params[key]?.(value, at, true);
    },
    dispose() {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already */ }
        if (n instanceof OscillatorNode) try { n.stop(); } catch { /* already */ }
      }
    },
  };
}
