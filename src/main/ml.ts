// Round 6: models + the analysis worker, in the main process.
// Models download on first use (sizes known up front, progress events) into
// userData/models/<id>/. Jobs run in a utility process (mlWorker.js) at Below Normal priority;
// Cancel kills that process (the next job starts a fresh one).
import { app, net, utilityProcess, type UtilityProcess } from 'electron';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { unzipToDir } from './unzip';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';

/** `unzip`: an archive unpacked into the model folder after the download (then deleted; a marker remembers it). */
export interface ModelFile { name: string; url: string; size: number; unzip?: boolean }
export interface ModelInfo {
  id: string;
  title: string;
  use: string;
  licence: string;
  /** Licence in a few words, for the download question. */
  short: string;
  source: string;
  files: ModelFile[];
}

const HF = 'https://huggingface.co';
export const MODELS: ModelInfo[] = [
  {
    id: 'beat-this',
    title: 'Beat This! (final0, v2 export)',
    use: 'beats and downbeats',
    // The first ONNX export (final0.onnx) froze the time axis (beats stop after ~6 s of each
    // chunk); final0-v2.onnx is the re-export with a dynamic time axis.
    licence: 'MIT (CPJKU Beat This! code and weights; ONNX conversion by ashudesai, MIT)',
    short: 'MIT',
    source: 'https://github.com/CPJKU/beat_this',
    files: [{ name: 'final0-v2.onnx', url: `${HF}/ashudesai/songbird-models/resolve/813eff2f8a91c564783f6194b062ade2b46a3ed6/final0-v2.onnx`, size: 83106058 }],
  },
  {
    id: 'demucs-6s',
    title: 'HT-Demucs 6 stems',
    use: 'splitting a recording into drums, bass, other, vocals, guitar, piano',
    short: 'code MIT, weights CC BY-NC 4.0 = personal/non-commercial use',
    licence: 'Demucs code MIT (Meta); weights: Meta Demucs v4, CC BY-NC 4.0 (non-commercial) per the ONNX export; ONNX export by HRSadeghi (MIT)',
    source: 'https://github.com/adefossez/demucs',
    files: [
      { name: 'htdemucs_6s.onnx', url: `${HF}/HRSadeghi/demucs-onnx/resolve/9128f6ee0f1b8e333b5b8d12613aefb3bebc249a/htdemucs_6s.onnx`, size: 110396023 },
      { name: 'htdemucs_6s.json', url: `${HF}/HRSadeghi/demucs-onnx/resolve/9128f6ee0f1b8e333b5b8d12613aefb3bebc249a/htdemucs_6s.json`, size: 333 },
    ],
  },
  {
    id: 'basic-pitch',
    title: 'basic-pitch (ICASSP 2022)',
    use: 'audio to notes',
    licence: 'Apache-2.0 (Spotify basic-pitch v0.4.0)',
    short: 'Apache-2.0',
    source: 'https://github.com/spotify/basic-pitch',
    files: [{ name: 'nmp.onnx', url: 'https://github.com/spotify/basic-pitch/raw/v0.4.0/basic_pitch/saved_models/icassp_2022/nmp.onnx', size: 230444 }],
  },
  // ---- Round 7 ----
  {
    id: 'qixuan',
    title: 'Qixuan DiffSinger voicebank v2.7.0',
    use: 'singing (English; the voicebank also sings Japanese and Chinese)',
    short: 'free; credit "Qixuan (绮萱) / DiffSinger" and mark songs as AI-made; no violent, sexual, political or religious content',
    licence: 'Qixuan Terms of Use (OpenVPI / yqzhishen): free use, new inference programs allowed; published songs must credit 绮萱 (Qixuan) and DiffSinger and be marked as AI-generated; the model must not be modified; no violent, sexual, political or religious content; outputs must not be used as training data. https://github.com/yqzhishen/qixuan-diffsinger/blob/main/terms_of_use/Terms_of_Use.zh-CN.md',
    source: 'https://github.com/yqzhishen/qixuan-diffsinger',
    files: [{ name: 'Qixuan_v2.7.0_DiffSinger_OpenUtau.zip', url: 'https://github.com/yqzhishen/qixuan-diffsinger/releases/download/v2.7.0/Qixuan_v2.7.0_DiffSinger_OpenUtau.zip', size: 420707627, unzip: true }],
  },
  {
    id: 'pc-nsf-hifigan',
    title: 'PC-NSF-HiFiGAN vocoder (OpenVPI 2025.02)',
    use: 'turning the singer spectrogram into audio',
    short: 'CC BY-NC-SA 4.0 = personal/non-commercial use',
    licence: 'OpenVPI pc_nsf_hifigan_44.1k_hop512_128bin_2025.02 weights: CC BY-NC-SA 4.0 (non-commercial, credit, share alike)',
    source: 'https://github.com/openvpi/vocoders',
    files: [{ name: 'pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep', url: 'https://github.com/openvpi/vocoders/releases/download/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep', size: 52760610, unzip: true }],
  },
  {
    id: 'fcpe',
    title: 'FCPE pitch tracker',
    use: 'the sung melody of a vocal recording',
    short: 'MIT',
    licence: 'MIT (CNChTu/FCPE; ONNX export tuneperfect/fcpe-onnx, MIT)',
    source: 'https://github.com/CNChTu/FCPE',
    files: [{ name: 'fcpe.onnx', url: `${HF}/tuneperfect/fcpe-onnx/resolve/f99224c40e48c8c84fa9935ff2cc6c3e92ec6ccf/fcpe.onnx`, size: 47805126 }],
  },
  {
    id: 'whisper-base',
    title: 'Whisper base (speech to text)',
    use: 'lyrics from a vocal recording',
    short: 'MIT',
    licence: 'OpenAI Whisper code and weights: MIT; ONNX export onnx-community/whisper-base_timestamped',
    source: 'https://github.com/openai/whisper',
    files: [
      { name: 'encoder_model_quantized.onnx', url: `${HF}/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/onnx/encoder_model_quantized.onnx`, size: 23159167 },
      { name: 'decoder_model_quantized.onnx', url: `${HF}/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/onnx/decoder_model_quantized.onnx`, size: 53362551 },
      { name: 'vocab.json', url: `${HF}/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/vocab.json`, size: 1036584 },
      { name: 'added_tokens.json', url: `${HF}/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/added_tokens.json`, size: 34604 },
    ],
  },
];

const unzipMarker = (id: string, f: ModelFile) => modelPath(id, f.name + '.unpacked');
const fileReady = (id: string, f: ModelFile) => {
  if (f.unzip) return existsSync(unzipMarker(id, f));
  const p = modelPath(id, f.name);
  return existsSync(p) && statSync(p).size === f.size;
};

export const modelsDir = () => join(app.getPath('userData'), 'models');
export const modelPath = (id: string, file: string) => join(modelsDir(), id, file);

export function modelStatus() {
  return MODELS.map((m) => ({
    ...m,
    bytes: m.files.reduce((s, f) => s + f.size, 0),
    installed: m.files.every((f) => fileReady(m.id, f)),
    dir: join(modelsDir(), m.id),
  }));
}

type Send = (channel: string, msg: unknown) => void;

let dlAbort: AbortController | null = null;

export async function downloadModel(id: string, send: Send): Promise<void> {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error('Unknown model ' + id);
  const total = m.files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  mkdirSync(join(modelsDir(), id), { recursive: true });
  dlAbort = new AbortController();
  const signal = dlAbort.signal;
  for (const f of m.files) {
    const dest = modelPath(id, f.name);
    if (fileReady(id, f)) {
      done += f.size;
      continue;
    }
    const part = dest + '.part';
    const res = await net.fetch(f.url, { signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${f.name}`);
    const out = createWriteStream(part);
    const reader = res.body.getReader();
    let last = 0;
    try {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        done += value.byteLength;
        if (Date.now() - last > 150) {
          last = Date.now();
          send('ml-progress', { kind: 'download', id, stage: 'download ' + m.title, done, total });
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    if (statSync(part).size !== f.size) {
      rmSync(part, { force: true });
      throw new Error(`${f.name}: downloaded ${statSync(part).size} bytes, expected ${f.size}`);
    }
    renameSync(part, dest);
    if (f.unzip) {
      send('ml-progress', { kind: 'download', id, stage: 'unpacking ' + m.title, done, total });
      await new Promise((r) => setTimeout(r, 10));
      unzipToDir(dest, join(modelsDir(), id));
      rmSync(dest, { force: true });
      writeFileSync(unzipMarker(id, f), String(f.size));
    }
  }
  send('ml-progress', { kind: 'download', id, stage: 'download ' + m.title, done: total, total });
  dlAbort = null;
}

// ------------------------------------------------------------------ worker

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; cmd: string };

export class MlHost {
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Last job wall time and the process id it ran in (reported by tests). */
  lastPid = 0;

  constructor(private send: Send) {}

  private start() {
    const p = utilityProcess.fork(join(__dirname, 'mlWorker.js'), [], { serviceName: 'musicGenie analysis', stdio: 'pipe' });
    let err = '';
    p.stderr?.on('data', (d) => { err = (err + String(d)).slice(-3000); });
    this.ready = new Promise<void>((resolve, reject) => {
      p.once('spawn', () => {
        try {
          if (p.pid) setPriority(p.pid, constants.priority.PRIORITY_BELOW_NORMAL);
          this.lastPid = p.pid ?? 0;
        } catch {
          /* not fatal */
        }
      });
      const t = setTimeout(() => reject(new Error('The analysis process did not start. ' + err)), 30000);
      p.on('message', (m: { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string; progress?: unknown }) => {
        if (m.ready) {
          clearTimeout(t);
          resolve();
          return;
        }
        if (m.progress) {
          this.send('ml-progress', { kind: 'job', id: m.id, ...(m.progress as object) });
          return;
        }
        const w = m.id !== undefined ? this.pending.get(m.id) : undefined;
        if (!w) return;
        this.pending.delete(m.id!);
        if (m.ok) w.resolve(m.result);
        else w.reject(new Error(m.error ?? 'Analysis failed'));
      });
    });
    p.on('exit', (code) => {
      const e = new Error(code === null || code === 0 ? 'Cancelled' : `The analysis process stopped (exit code ${code}). ${err.trim()}`);
      for (const w of this.pending.values()) w.reject(e);
      this.pending.clear();
      if (this.proc === p) {
        this.proc = null;
        this.ready = null;
      }
    });
    this.proc = p;
  }

  async run<T = unknown>(cmd: string, args: unknown): Promise<T> {
    if (!this.proc) this.start();
    await this.ready;
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, cmd });
      this.proc!.postMessage({ id, cmd, args });
    });
  }

  get busy() {
    return this.pending.size > 0;
  }

  /** Stop whatever is running (job or download). */
  cancel() {
    dlAbort?.abort();
    dlAbort = null;
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      this.ready = null;
      for (const w of this.pending.values()) w.reject(new Error('Cancelled'));
      this.pending.clear();
      p.kill();
    }
  }

  stop() {
    this.cancel();
  }
}
