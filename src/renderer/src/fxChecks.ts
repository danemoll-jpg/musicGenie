// Round 5 effect checks (run in the app, offline, never through the speakers): each effect gets a
// test signal and must change the measured signal the way it should.
import { dbToGain, newEffect, type Effect, type FxType } from '../../model';
import { renderThroughFx } from './audio/offline';

const SR = 48000;

function tone(freqs: number[], amp: number, secs: number): Float32Array {
  const n = Math.round(secs * SR);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / SR);
    out[2 * i] = out[2 * i + 1] = (amp * v) / freqs.length;
  }
  return out;
}
function noise(amp: number, secs: number, seed = 7): Float32Array {
  let s = seed;
  const n = Math.round(secs * SR);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[2 * i] = out[2 * i + 1] = amp * ((s / 4294967296) * 2 - 1);
  }
  return out;
}
function impulse(secs: number, at = 0.1): Float32Array {
  const out = new Float32Array(Math.round(secs * SR) * 2);
  const i = Math.round(at * SR);
  out[2 * i] = out[2 * i + 1] = 0.9;
  return out;
}
/** RMS (dB) of the left channel between two times. */
function rmsDb(x: Float32Array, from = 0.2, to?: number): number {
  const a = Math.round(from * SR);
  const b = Math.min(x.length / 2, Math.round((to ?? x.length / 2 / SR) * SR));
  let e = 0;
  for (let i = a; i < b; i++) e += x[2 * i] * x[2 * i];
  return 10 * Math.log10(e / Math.max(1, b - a) + 1e-20);
}
/** Level (dB) of one frequency (Goertzel) in the left channel after `from` s. */
function bandDb(x: Float32Array, f: number, from = 0.2): number {
  const a = Math.round(from * SR);
  const n = x.length / 2 - a;
  const w = (2 * Math.PI * f) / SR;
  const c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = x[2 * (a + i)] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const p = s1 * s1 + s2 * s2 - c * s1 * s2;
  return 10 * Math.log10((4 * p) / (n * n) + 1e-20);
}
/** How much high-frequency content: RMS of the first difference relative to the RMS (white noise ~ +3 dB). */
function hfDb(x: Float32Array, from = 0.2): number {
  const d = new Float32Array(x.length);
  for (let i = 1; i < x.length / 2; i++) d[2 * i] = x[2 * i] - x[2 * (i - 1)];
  return rmsDb(d, from) - rmsDb(x, from);
}
function correlation(a: Float32Array, b: Float32Array, from = 0.2): number {
  const s = Math.round(from * SR);
  let ab = 0, aa = 0, bb = 0;
  for (let i = s; i < a.length / 2; i++) { ab += a[2 * i] * b[2 * i]; aa += a[2 * i] ** 2; bb += b[2 * i] ** 2; }
  return ab / Math.sqrt(aa * bb + 1e-20);
}
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const fx = (t: FxType, p: Record<string, number> = {}): Effect[] => [newEffect(t, p)];
const run = (x: Float32Array, e: Effect[]) => renderThroughFx(x, SR, e, 120);

export interface FxCheck { effect: string; test: string; measured: Record<string, number>; pass: boolean }

export async function runFxChecks(): Promise<FxCheck[]> {
  const out: FxCheck[] = [];
  const add = (effect: string, test: string, measured: Record<string, number>, pass: boolean) => {
    for (const k of Object.keys(measured)) measured[k] = Math.round(measured[k] * 100) / 100;
    out.push({ effect, test, measured, pass });
  };

  // EQ: low shelf -12 dB lowers the lows, leaves the highs.
  {
    const x = tone([80, 5000], 0.4, 1.2);
    const y = await run(x, fx('eq3', { low: -12, lowFreq: 200 }));
    const d80 = bandDb(y, 80) - bandDb(x, 80);
    const d5k = bandDb(y, 5000) - bandDb(x, 5000);
    add('EQ (3-band)', 'low shelf -12 dB @200 Hz', { change80Hz: d80, change5kHz: d5k }, d80 < -9 && Math.abs(d5k) < 1);
  }
  // Parametric EQ: low cut at 500 Hz removes 100 Hz, keeps 3 kHz; +9 dB bell at 3 kHz.
  {
    const x = tone([100, 3000], 0.4, 1.2);
    const y = await run(x, fx('peq', { lowCut: 500, gain: 0 }));
    const d100 = bandDb(y, 100) - bandDb(x, 100);
    const d3k = bandDb(y, 3000) - bandDb(x, 3000);
    add('EQ (parametric)', 'low cut 500 Hz', { change100Hz: d100, change3kHz: d3k }, d100 < -20 && Math.abs(d3k) < 1);
    const z = await run(x, fx('peq', { freq: 3000, gain: 9, q: 2 }));
    const b3k = bandDb(z, 3000) - bandDb(x, 3000);
    add('EQ (parametric)', 'bell +9 dB @3 kHz', { change3kHz: b3k, change100Hz: bandDb(z, 100) - bandDb(x, 100) }, Math.abs(b3k - 9) < 1);
  }
  // Compressor: loud signal turned down, quiet one left alone.
  {
    const e = fx('comp', { threshold: -30, ratio: 8, attack: 1, release: 50, knee: 0, makeup: 0 });
    const loud = tone([440], 0.5, 1.5);
    const quiet = tone([440], 0.005, 1.5);
    const gl = rmsDb(await run(loud, e), 0.5) - rmsDb(loud, 0.5);
    const gq = rmsDb(await run(quiet, e), 0.5) - rmsDb(quiet, 0.5);
    add('Compressor', 'threshold -30 dB, 8:1', { loudChangeDb: gl, quietChangeDb: gq }, gl < -12 && Math.abs(gq) < 1);
  }
  // Gate: quiet noise is shut, a loud tone passes.
  {
    const e = fx('gate', { threshold: -40, attack: 1, hold: 20, release: 20 });
    const q = noise(0.001, 1);
    const l = tone([300], 0.5, 1);
    const gq = rmsDb(await run(q, e), 0.3) - rmsDb(q, 0.3);
    const gl = rmsDb(await run(l, e), 0.3) - rmsDb(l, 0.3);
    add('Gate', 'threshold -40 dB', { quietNoiseChangeDb: gq, loudToneChangeDb: gl }, gq < -40 && Math.abs(gl) < 1);
  }
  // Overdrive / distortion: harmonics appear.
  for (const mode of [0, 1, 2]) {
    const x = tone([220], 0.5, 1);
    const y = await run(x, fx('drive', { drive: 0.7, mode, tone: 12000, level: 0 }));
    const h = Math.max(bandDb(y, 660), bandDb(y, 440)) - bandDb(y, 220);
    const h0 = Math.max(bandDb(x, 660), bandDb(x, 440)) - bandDb(x, 220);
    add('Overdrive / distortion', ['overdrive', 'distortion', 'fuzz'][mode] + ' on a 220 Hz sine', { harmonicsVsFundamentalDb: h, cleanDb: h0 }, h > -25 && h0 < -60);
  }
  // Amp sims: harmonics + the cabinet rolls off the top end.
  for (const t of ['amp', 'bassamp'] as const) {
    const x = tone([110], 0.5, 1);
    const y = await run(x, fx(t, { gain: 0.7, level: 0, ...(t === 'bassamp' ? { blend: 0 } : {}) }));
    const h = bandDb(y, 330) - bandDb(y, 110);
    const n = noise(0.3, 1);
    const ny = await run(n, fx(t, { gain: 0, level: 0, ...(t === 'bassamp' ? { blend: 0 } : {}) }));
    // High-frequency content: level of the sample-to-sample difference relative to the signal.
    const top = hfDb(ny);
    const top0 = hfDb(n);
    add(t === 'amp' ? 'Guitar amp' : 'Bass amp', 'harmonics on 110 Hz; cabinet on white noise', { harmonic3rdDb: h, cabHighFreqDb: top, dryHighFreqDb: top0 }, h > -30 && top - top0 < -10);
  }
  // Modulation: chorus / flanger / phaser change the signal over time, keep the level.
  for (const t of ['chorus', 'flanger', 'phaser'] as const) {
    const x = noise(0.3, 2);
    const y = await run(x, fx(t, { mix: 0.5, depth: 0.8 }));
    const c = correlation(x, y);
    const lv = rmsDb(y) - rmsDb(x);
    add(t[0].toUpperCase() + t.slice(1), 'on white noise', { correlationWithDry: c, levelChangeDb: lv }, c < 0.97 && Math.abs(lv) < 6);
  }
  // Tremolo: the level swings rate times a second.
  {
    const x = tone([440], 0.5, 2);
    const y = await run(x, fx('tremolo', { rate: 5, depth: 1 }));
    const win = Math.round(0.01 * SR);
    const env: number[] = [];
    for (let i = Math.round(0.2 * SR); i + win < y.length / 2; i += win) {
      let e = 0;
      for (let j = 0; j < win; j++) e += y[2 * (i + j)] ** 2;
      env.push(Math.sqrt(e / win));
    }
    const max = Math.max(...env);
    const min = Math.min(...env);
    let peaks = 0;
    for (let i = 1; i + 1 < env.length; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.7 * max) peaks++;
    const secs = (env.length * win) / SR;
    add('Tremolo', '5 Hz, depth 1', { swingDb: 20 * Math.log10(max / (min + 1e-9)), peaksPerSecond: peaks / secs }, 20 * Math.log10(max / (min + 1e-9)) > 12 && Math.abs(peaks / secs - 5) < 1);
  }
  // Delay: 1/8 note at 120 bpm = an echo 250 ms after the impulse.
  {
    const x = impulse(1.2, 0.1);
    const y = await run(x, fx('delay', { note: 1, feedback: 0, mix: 0.5, tone: 12000 }));
    let at = 0;
    let best = 0;
    for (let i = Math.round(0.2 * SR); i < y.length / 2; i++) if (Math.abs(y[2 * i]) > best) { best = Math.abs(y[2 * i]); at = i; }
    const echoMs = ((at - 0.1 * SR) / SR) * 1000;
    add('Delay', '1/8 at 120 bpm', { echoAfterMs: echoMs, echoLevel: best }, Math.abs(echoMs - 250) < 3 && best > 0.1);
  }
  // Reverb: a tail after an impulse (none without it), decaying.
  {
    const x = impulse(2.5, 0.1);
    const y = await run(x, fx('reverb', { type: 1, decay: 1.5, predelay: 10, mix: 0.5 }));
    const tail1 = rmsDb(y, 0.3, 0.6);
    const tail2 = rmsDb(y, 1.2, 1.5);
    const dry = rmsDb(x, 0.3, 0.6);
    add('Reverb', 'hall, 1.5 s, on an impulse', { tail300to600msDb: tail1, tail1200to1500msDb: tail2, dryDb: dry }, tail1 > -70 && tail2 < tail1 - 10 && dry < -150);
  }
  // Limiter: +6 dB too hot in, nothing over the ceiling out.
  {
    const x = tone([200, 330], 0.95, 1);
    const y = await run(x, fx('limiter', { ceiling: -3, gain: 6, release: 50 }));
    const pk = 20 * Math.log10(peak(y));
    add('Limiter', 'ceiling -3 dB, +6 dB input gain', { outputPeakDb: pk, ceilingDb: -3 }, peak(y) <= dbToGain(-3) + 1e-4);
  }
  return out;
}
