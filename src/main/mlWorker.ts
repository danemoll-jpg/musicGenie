// Round 6 analysis worker: an Electron utility process (plain Node, no window) started by
// src/main/ml.ts at Below Normal priority. Runs the ONNX models through onnxruntime-node
// (DirectML on the GPU when it works, otherwise the CPU) and the DSP jobs (drums, pitch).
// One job at a time; Cancel = the host kills this process.
import * as ort from 'onnxruntime-node';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

async function transcribe(id: number, a: { wav: string; model: string; opts?: BpNoteOptions }) {
  const pcm = loadPcm(a.wav);
  const x = mono22(pcm);
  const { s, provider } = await session(a.model);
  const t0 = performance.now();
  const inName = s.inputNames[0];
  // Output order in basic-pitch's ONNX: StatefulPartitionedCall:0 contour, :1 note, :2 onset.
  const byName = (k: string) => s.outputNames.find((o) => o.endsWith(':' + k)) ?? k;
  const outs = await runBasicPitch(x, async (w) => {
    const r = await s.run({ [inName]: new ort.Tensor('float32', w, [1, w.length, 1]) });
    return { note: r[byName('1')].data as Float32Array, onset: r[byName('2')].data as Float32Array };
  }, (d, t) => progress(id, 'notes', d, t));
  const notes = bpNotes(outs, a.opts);
  return { notes, provider, inferMs: Math.round(performance.now() - t0), durationS: x.length / 22050 };
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

const jobs: Record<string, (id: number, a: never) => Promise<unknown>> = { probe, beats, stems, transcribe, drums, pitch };

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
