// Round 6 analysis worker: an Electron utility process (plain Node, no window) started by
// src/main/ml.ts at Below Normal priority. Runs the ONNX models through onnxruntime-node
// (DirectML on the GPU when it works, otherwise the CPU) and the DSP jobs (drums, pitch).
// One job at a time; Cancel = the host kills this process.
import * as ort from 'onnxruntime-node';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { layoutPhrases, parseDsDict, singPhrases, type DsDict, type SingSettings, type SungSyllable } from '../ml/sing';
import { f0ToNotes, frameEnergy } from '../ml/voice';
import { centOffset, detectTuning, fixBassOctaves, guitarLines, refineOnsets } from '../ml/refine';
import { makeDecoder, whisperWords } from '../ml/whisper';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { beatThisFeatures, downmix, resample } from '../ml/dsp';
import { beatLogits, pickBeats } from '../ml/beats';
import { separate, type DemucsConfig } from '../ml/demucs';
import { BP_SR, bpNotes, runBasicPitch, type BpNoteOptions } from '../ml/basicPitch';
import { transcribeDrums } from '../ml/drums';
import { estimatePitch } from '../ml/pitch';
import { readWav, writeWav16, type Pcm } from '../ml/wav';

type Provider = 'dml' | 'cpu';
interface Req { id: number; cmd: string; args: Record<string, unknown> }

const port = (process as unknown as { parentPort: { on: (e: 'message', f: (m: { data: Req }) => void) => void; postMessage: (m: unknown) => void } }).parentPort;

const sessions = new Map<string, { s: ort.InferenceSession; provider: Provider }>();
let preferCpu = false;

async function session(path: string, force?: Provider): Promise<{ s: ort.InferenceSession; provider: Provider }> {
  const key = path + '|' + (force ?? '');
  const hit = sessions.get(key);
  if (hit) return hit;
  const opts = (p: Provider): ort.InferenceSession.SessionOptions => {
    const o: ort.InferenceSession.SessionOptions = {
      executionProviders: [p],
      graphOptimizationLevel: 'all',
      // DirectML needs memory patterns off and sequential execution.
      enableMemPattern: p !== 'dml',
      executionMode: 'sequential',
    };
    // Leave a couple of cores for the app and Dan's work.
    if (p === 'cpu') o.intraOpNumThreads = Math.max(1, Math.min(6, cpus().length - 2));
    return o;
  };
  let r: { s: ort.InferenceSession; provider: Provider } | null = null;
  const order: Provider[] = force ? [force] : preferCpu ? ['cpu'] : ['dml', 'cpu'];
  let lastErr: unknown = null;
  for (const p of order) {
    try {
      r = { s: await ort.InferenceSession.create(path, opts(p)), provider: p };
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!r) throw new Error('Could not load the model: ' + String((lastErr as Error)?.message ?? lastErr));
  sessions.set(key, r);
  return r;
}

const progress = (id: number, stage: string, done: number, total: number) => port.postMessage({ id, progress: { stage, done, total } });

function loadPcm(path: string): Pcm {
  const b = readFileSync(path);
  return readWav(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
}

function mono22(p: Pcm): Float32Array {
  return resample(downmix(p.channels), p.sampleRate, 22050);
}

// ------------------------------------------------------------------ jobs

async function probe(id: number, a: { model: string }) {
  // basic-pitch's graph is small: one 2 s window, timed on each provider.
  const out: Record<string, unknown> = { ortVersion: ort.env.versions?.common ?? '?' };
  for (const p of ['dml', 'cpu'] as Provider[]) {
    try {
      const t0 = performance.now();
      const { s } = await session(a.model, p);
      const loadMs = performance.now() - t0;
      const x = new Float32Array(43844);
      for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / BP_SR);
      const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 43844, 1]) };
      await s.run(feeds); // warm-up
      const t1 = performance.now();
      const N = 5;
      let shape: readonly number[] = [];
      for (let k = 0; k < N; k++) {
        const r = await s.run(feeds);
        shape = r[s.outputNames[0]].dims;
      }
      out[p] = { ok: true, loadMs: Math.round(loadMs), runMs: +((performance.now() - t1) / N).toFixed(1), outShape: shape };
    } catch (e) {
      out[p] = { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
    }
    progress(id, 'probe', p === 'dml' ? 1 : 2, 2);
  }
  return out;
}

async function beats(id: number, a: { wav: string; model: string }) {
  const pcm = loadPcm(a.wav);
  progress(id, 'features', 0, 1);
  const x = mono22(pcm);
  const f = beatThisFeatures(x);
  // Beat This! is a transformer fed variable-length chunks: DirectML recompiles per shape and was
  // ~3x slower than the CPU here, so it runs on the CPU.
  const { s, provider } = await session(a.model, 'cpu');
  const t0 = performance.now();
  const lg = await beatLogits(f.data, f.frames, async (spect, frames) => {
    const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', spect, [1, frames, 128]) });
    const [b, d] = s.outputNames;
    return { beat: r[b].data as Float32Array, downbeat: r[d].data as Float32Array };
  }, (d, t) => progress(id, 'beats', d, t));
  const res = pickBeats(lg.beat, lg.downbeat);
  let inPeak = 0;
  for (const v of x) inPeak = Math.max(inPeak, Math.abs(v));
  let maxLogit = -Infinity;
  for (const v of lg.beat) maxLogit = Math.max(maxLogit, v);
  return { ...res, inPeak, maxLogit, sampleRate: pcm.sampleRate, channels: pcm.channels.length, durationS: pcm.channels[0].length / pcm.sampleRate, provider, inferMs: Math.round(performance.now() - t0) };
}

async function stems(id: number, a: { wav: string; model: string; config: string; outDir: string; prefix: string }) {
  const cfg = JSON.parse(readFileSync(a.config, 'utf8')) as DemucsConfig;
  const pcm = loadPcm(a.wav);
  const sr = cfg.samplerate;
  let L = resample(pcm.channels[0], pcm.sampleRate, sr);
  let R = pcm.channels.length > 1 ? resample(pcm.channels[1], pcm.sampleRate, sr) : L;
  const n = L.length;
  const mix = new Float32Array(2 * n);
  mix.set(L, 0);
  mix.set(R, n);
  L = R = new Float32Array(0);
  const { s, provider } = await session(a.model);
  const t0 = performance.now();
  const [inMix, inMag] = s.inputNames;
  const [outSpec, outWav] = s.outputNames;
  const batch = provider === 'dml' ? 2 : 1;
  let out: Float32Array[];
  try {
    out = await separate(cfg, async (m, g, b) => {
      const r = await s.run({
        [inMix]: new ort.Tensor('float32', m, [b, 2, cfg.segment_samples]),
        [inMag]: new ort.Tensor('float32', g, [b, 4, cfg.freq_bins, cfg.frames]),
      });
      return { spec: r[outSpec].data as Float32Array, wav: r[outWav].data as Float32Array };
    }, mix, n, batch, (d, t) => progress(id, 'stems', d, t));
  } catch (e) {
    // DirectML can fail at run time on some drivers: retry once on the CPU.
    if (provider !== 'dml') throw e;
    preferCpu = true;
    sessions.clear();
    return stems(id, a);
  }
  mkdirSync(a.outDir, { recursive: true });
  const files: { name: string; file: string; rms: number }[] = [];
  for (let k = 0; k < cfg.sources.length; k++) {
    const o = out[k];
    const ch = [o.subarray(0, n), o.subarray(n, 2 * n)];
    let e = 0;
    for (let i = 0; i < 2 * n; i++) e += o[i] * o[i];
    const file = join(a.outDir, `${a.prefix}-${cfg.sources[k]}.wav`);
    writeFileSync(file, writeWav16({ sampleRate: sr, channels: ch }));
    files.push({ name: cfg.sources[k], file, rms: Math.sqrt(e / (2 * n)) });
  }
  return { stems: files, provider, seconds: +((performance.now() - t0) / 1000).toFixed(1), audioSeconds: n / sr };
}

/** Round 7 refinements around basic-pitch (each can be switched off; the benchmark compares). */
interface Refine { part: 'bass' | 'guitar' | 'lead' | 'other'; cents?: boolean; octaves?: boolean; lines?: boolean; onsets?: boolean; tuning?: boolean }

async function transcribe(id: number, a: { wav: string; model: string; opts?: BpNoteOptions; refine?: Refine }) {
  const pcm = loadPcm(a.wav);
  let x = mono22(pcm);
  const rf = a.refine;
  const info: Record<string, unknown> = {};
  // 1. Tuning offset from A440: shift the audio onto the semitone grid (times are scaled back).
  let k = 1;
  if (rf?.cents) {
    const c = centOffset(x, 22050);
    info.cents = c.cents;
    if (Math.abs(c.cents) >= 8) {
      k = Math.pow(2, -c.cents / 1200);
      x = resample(x, 22050, 22050 / k);
    }
  }
  const { s, provider } = await session(a.model);
  const t0 = performance.now();
  const inName = s.inputNames[0];
  // Output order in basic-pitch's ONNX: StatefulPartitionedCall:0 contour, :1 note, :2 onset.
  const byName = (kk: string) => s.outputNames.find((o) => o.endsWith(':' + kk)) ?? kk;
  const outs = await runBasicPitch(x, async (w) => {
    const r = await s.run({ [inName]: new ort.Tensor('float32', w, [1, w.length, 1]) });
    return { note: r[byName('1')].data as Float32Array, onset: r[byName('2')].data as Float32Array };
  }, (d, t) => progress(id, 'notes', d, t));
  let notes = bpNotes(outs, a.opts);
  if (k !== 1) notes = notes.map((n) => ({ ...n, startS: n.startS * k, endS: n.endS * k }));
  if (rf) {
    const orig = downmix(pcm.channels);
    if (rf.octaves && rf.part === 'bass') { const r = fixBassOctaves(notes, orig, pcm.sampleRate); notes = r.notes; info.octaveMoved = r.moved; }
    if (rf.lines && (rf.part === 'guitar' || rf.part === 'lead')) { const r = guitarLines(notes); notes = r.notes; info.linesDropped = r.dropped; info.chordOnsets = r.chordOnsets; info.lineOnsets = r.lineOnsets; }
    if (rf.onsets && rf.part !== 'other') { const r = refineOnsets(notes, orig, pcm.sampleRate); notes = r.notes; info.onsetShiftMs = r.meanShiftMs; }
    if (rf.tuning && (rf.part === 'bass' || rf.part === 'guitar' || rf.part === 'lead')) info.tuning = detectTuning(notes, rf.part === 'bass' ? 'bass' : 'guitar');
  }
  return { notes, provider, inferMs: Math.round(performance.now() - t0), durationS: x.length / 22050, info };
}

async function drums(id: number, a: { wav: string }) {
  const pcm = loadPcm(a.wav);
  progress(id, 'drums', 0, 1);
  const x = downmix(pcm.channels);
  const hits = transcribeDrums(x, pcm.sampleRate);
  progress(id, 'drums', 1, 1);
  return { hits };
}

async function pitch(_id: number, a: { wav: string; fromS: number; lenS: number }) {
  const pcm = loadPcm(a.wav);
  const x = downmix(pcm.channels);
  const i0 = Math.floor(a.fromS * pcm.sampleRate);
  return { hz: estimatePitch(x.subarray(i0, i0 + Math.floor(a.lenS * pcm.sampleRate)), pcm.sampleRate) };
}

// ------------------------------------------------------------------ singing (Round 7)

const yamlKeys = (file: string): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_]+):\s*(.+?)\s*$/.exec(l);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const dictCache = new Map<string, DsDict>();

async function sing(id: number, a: { bank: string; vocoder: string; syllables: SungSyllable[]; settings: SingSettings; totalMs: number; out: string }) {
  const t0 = performance.now();
  const cfg = yamlKeys(join(a.bank, 'dsconfig.yaml'));
  const vcfg = existsSync(join(a.bank, 'dsvariance', 'dsconfig.yaml')) ? yamlKeys(join(a.bank, 'dsvariance', 'dsconfig.yaml')) : null;
  const vocCfg = yamlKeys(join(a.vocoder, 'vocoder.yaml'));
  progress(id, 'loading the voice', 0, 1);
  const dictFile = ['dsdur/dsdict-en.yaml', 'dsdict-en.yaml', 'dsdur/dsdict.yaml', 'dsdict.yaml'].map((f) => join(a.bank, f)).find((f) => existsSync(f));
  if (!dictFile) throw new Error('The voicebank has no English dictionary (dsdict-en.yaml).');
  let dict = dictCache.get(dictFile);
  if (!dict) { dict = parseDsDict(readFileSync(dictFile, 'utf8')); dictCache.set(dictFile, dict); }
  const phrases = layoutPhrases(dict, a.syllables, a.settings.breath);
  const ac = await session(join(a.bank, cfg.acoustic));
  const voc = await session(join(a.vocoder, vocCfg.model));
  const ling = vcfg ? await session(join(a.bank, 'dsvariance', vcfg.linguistic)) : null;
  const vari = vcfg ? await session(join(a.bank, 'dsvariance', vcfg.variance)) : null;
  const I = (x: number[]) => new ort.Tensor('int64', BigInt64Array.from(x.map((v) => BigInt(v))), [1, x.length]);
  const F = (x: Float32Array) => new ort.Tensor('float32', x, [1, x.length]);
  const S = (n: number) => new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), []);
  const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
  const has = (s: ort.InferenceSession, n: string) => s.inputNames.includes(n);
  const res = await singPhrases({
    acousticIds: json(join(a.bank, cfg.phonemes)),
    varianceIds: vcfg ? json(join(a.bank, 'dsvariance', vcfg.phonemes)) : null,
    languages: cfg.languages ? json(join(a.bank, cfg.languages)) : {},
    acoustic: async (x) => {
      const s = ac.s;
      const feeds: Record<string, ort.Tensor> = { tokens: I(x.tokens), durations: I(x.durations), f0: F(x.f0) };
      if (has(s, 'languages')) feeds.languages = I(x.languages);
      if (has(s, 'breathiness')) feeds.breathiness = F(x.breathiness);
      if (has(s, 'voicing')) feeds.voicing = F(x.voicing);
      if (has(s, 'gender')) feeds.gender = F(x.gender);
      if (has(s, 'velocity')) feeds.velocity = F(x.velocity);
      if (has(s, 'depth')) feeds.depth = new ort.Tensor('float32', new Float32Array([x.depth]), []);
      if (has(s, 'steps')) feeds.steps = S(x.steps);
      const r = await s.run(feeds);
      return r[s.outputNames[0]].data as Float32Array;
    },
    variance: ling && vari ? async (x) => {
      const l = await ling.s.run({ tokens: I(x.tokens), languages: I(x.languages), ph_dur: I(x.durations) });
      const T = x.pitch.length;
      const r = await vari.s.run({
        encoder_out: l.encoder_out, ph_dur: I(x.durations), pitch: F(x.pitch), breathiness: F(new Float32Array(T)), voicing: F(new Float32Array(T)),
        retake: new ort.Tensor('bool', new Uint8Array(T * 2).fill(1), [1, T, 2]), steps: S(x.steps),
      });
      return { breathiness: r.breathiness_pred.data as Float32Array, voicing: r.voicing_pred.data as Float32Array };
    } : null,
    vocoder: async (mel, f0, T) => {
      const r = await voc.s.run({ mel: new ort.Tensor('float32', mel, [1, T, 128]), f0: F(f0) });
      return r[voc.s.outputNames[0]].data as Float32Array;
    },
  }, phrases, a.settings, a.totalMs, (d, t) => progress(id, 'singing', d, t));
  let peak = 0;
  for (const v of res.audio) peak = Math.max(peak, Math.abs(v));
  // Leave headroom: peak at -3 dBFS at most.
  const k = peak > 0.708 ? 0.708 / peak : 1;
  if (k !== 1) for (let i = 0; i < res.audio.length; i++) res.audio[i] *= k;
  mkdirSync(join(a.out, '..'), { recursive: true });
  writeFileSync(a.out, writeWav16({ sampleRate: res.sampleRate, channels: [res.audio] }));
  return {
    file: a.out, phrases: phrases.length, frames: res.frames, provider: ac.provider, seconds: +((performance.now() - t0) / 1000).toFixed(1),
    unknownWords: [...new Set(a.syllables.map((s) => s.text))].length, durationS: res.audio.length / res.sampleRate,
  };
}

// ------------------------------------------------------------------ vocals from a recording (Round 7)

function mono16(path: string): Float32Array {
  const pcm = loadPcm(path);
  return resample(downmix(pcm.channels), pcm.sampleRate, 16000);
}

/** FCPE f0 (30 s pieces) -> notes. */
async function voiceNotes(id: number, a: { wav: string; model: string; minPitch?: number; maxPitch?: number }) {
  const x = mono16(a.wav);
  const { s, provider } = await session(a.model, 'cpu');
  const t0 = performance.now();
  const piece = 30 * 16000;
  const parts: Float32Array[] = [];
  for (let at = 0; at < x.length; at += piece) {
    const seg = x.subarray(at, Math.min(x.length, at + piece));
    const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', seg, [1, seg.length]) });
    const f = r[s.outputNames[0]].data as Float32Array;
    parts.push(f.subarray(0, Math.ceil(seg.length / 160)));
    progress(id, 'melody', Math.min(x.length, at + piece), x.length);
  }
  const f0 = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { f0.set(p, o); o += p.length; }
  const res = f0ToNotes(f0, frameEnergy(x, f0.length), { minPitch: a.minPitch, maxPitch: a.maxPitch });
  return { ...res, provider, inferMs: Math.round(performance.now() - t0), durationS: x.length / 16000 };
}

/** Whisper words with times (s). */
async function whisper(id: number, a: { wav: string; encoder: string; decoder: string; vocab: string }) {
  const x = mono16(a.wav);
  const enc = await session(a.encoder, 'cpu');
  const dec = await session(a.decoder, 'cpu');
  const decodeText = makeDecoder(JSON.parse(readFileSync(a.vocab, 'utf8')));
  const t0 = performance.now();
  const words = await whisperWords({
    encode: async (mel) => {
      const o = await enc.s.run({ [enc.s.inputNames[0]]: new ort.Tensor('float32', mel, [1, 80, 3000]) });
      const h = o[enc.s.outputNames[0]];
      return { data: h.data as Float32Array, dims: h.dims };
    },
    decode: async (ids, e) => {
      const o = await dec.s.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map((v) => BigInt(v))), [1, ids.length]),
        encoder_hidden_states: new ort.Tensor('float32', e.data, e.dims as number[]),
      });
      const cross = [0, 1, 2, 3, 4, 5].map((l) => o['cross_attentions.' + l]?.data as Float32Array);
      return { logits: o.logits.data as Float32Array, vocab: o.logits.dims[2], cross, heads: o['cross_attentions.0']?.dims[1] ?? 8 };
    },
    decodeText,
  }, x, (d, t) => progress(id, 'lyrics', d, t));
  return { words, inferMs: Math.round(performance.now() - t0), durationS: x.length / 16000 };
}

const jobs: Record<string, (id: number, a: never) => Promise<unknown>> = { probe, beats, stems, transcribe, drums, pitch, sing, voiceNotes, whisper };

port.on('message', async (e) => {
  const { id, cmd, args } = e.data;
  try {
    const fn = jobs[cmd];
    if (!fn) throw new Error('Unknown job: ' + cmd);
    const result = await fn(id, args as never);
    port.postMessage({ id, ok: true, result });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
});
port.postMessage({ ready: true });
