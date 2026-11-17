// Round 6, item 8: sheet music from PDF/photo through Audiveris (AGPL-3.0, run as a separate
// program, not linked). The app downloads the official Windows console MSI once (sizes known,
// progress shown) and EXTRACTS it into userData/tools/audiveris with `msiexec /a` (an
// administrative unpack: no system install, no admin prompt, no window). Jobs run at Below Normal.
import { app, net } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';

export const AUDIVERIS = {
  version: '5.11.0',
  url: 'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi',
  size: 85062430,
  licence: 'AGPL-3.0 (Audiveris; runs as its own program, bundled Java runtime inside)',
};

const dir = () => join(app.getPath('userData'), 'tools', 'audiveris');
const exePath = () => join(dir(), 'Audiveris', 'Audiveris.exe');

export function omrStatus() {
  const exe = exePath();
  const ok = existsSync(exe);
  return { ...AUDIVERIS, installed: ok, exe: ok ? exe : null, version: ok ? AUDIVERIS.version : null };
}

let proc: ChildProcess | null = null;
let abort: AbortController | null = null;

type Send = (channel: string, msg: unknown) => void;

function belowNormal(p: ChildProcess) {
  try {
    if (p.pid) setPriority(p.pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* not fatal */
  }
}

export async function omrInstall(send: Send): Promise<{ exe: string }> {
  if (existsSync(exePath())) return { exe: exePath() };
  mkdirSync(dir(), { recursive: true });
  const msi = join(app.getPath('userData'), 'tools', 'audiveris.msi.part');
  abort = new AbortController();
  const res = await net.fetch(AUDIVERIS.url, { signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const out = createWriteStream(msi);
  const reader = res.body.getReader();
  let done = 0, last = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      if (!out.write(r.value)) await new Promise<void>((ok) => out.once('drain', () => ok()));
      done += r.value.byteLength;
      if (Date.now() - last > 150) {
        last = Date.now();
        send('ml-progress', { kind: 'omr', stage: 'download Audiveris ' + AUDIVERIS.version, done, total: AUDIVERIS.size });
      }
    }
  } finally {
    await new Promise<void>((ok) => out.end(() => ok()));
    abort = null;
  }
  if (statSync(msi).size !== AUDIVERIS.size) {
    rmSync(msi, { force: true });
    throw new Error('The Audiveris download is incomplete.');
  }
  send('ml-progress', { kind: 'omr', stage: 'unpacking Audiveris', done: 0, total: 1 });
  await new Promise<void>((resolve, reject) => {
    const p = spawn('msiexec', ['/a', msi, '/qn', 'TARGETDIR=' + dir()], { windowsHide: true, stdio: 'ignore' });
    belowNormal(p);
    proc = p;
    p.on('exit', (code) => { proc = null; code === 0 ? resolve() : reject(new Error('Unpacking Audiveris failed (msiexec exit ' + code + ').')); });
    p.on('error', reject);
  });
  rmSync(msi, { force: true });
  // msiexec /a leaves a copy of the .msi in the target folder: not needed.
  for (const f of readdirSync(dir())) if (f.toLowerCase().endsWith('.msi')) rmSync(join(dir(), f), { force: true });
  if (!existsSync(exePath())) throw new Error('Audiveris was unpacked but Audiveris.exe is missing.');
  return { exe: exePath() };
}

export interface OmrIssue { sheet: number; measure?: number; text: string }

/** Lines Audiveris logs as warnings/errors, with the sheet (page) and measure when it says them. */
export function parseOmrLog(log: string): OmrIssue[] {
  const out: OmrIssue[] = [];
  let sheet = 1;
  for (const line of log.split(/\r?\n/)) {
    const sm = /(?:sheet|Sheet)[#\s]*(\d+)|\{#(\d+)\}|#(\d+)\s*\]/.exec(line);
    if (sm) sheet = Number(sm[1] ?? sm[2] ?? sm[3]) || sheet;
    if (!/\b(WARN|ERROR)\b/.test(line)) continue;
    // Set-up notes, not doubts about the music (no OCR languages for lyrics/chord text; a guessed
    // beam thickness on a cleanly engraved page).
    if (/Languages|TesseractOCR|ScaleBuilder/.test(line)) continue;
    const mm = /measure[#\s]*#?(\d+)|\bm#?(\d+)\b/i.exec(line);
    out.push({ sheet, measure: mm ? Number(mm[1] ?? mm[2]) : undefined, text: line.replace(/^.*?\b(WARN|ERROR)\b\s*/, '$1 ').trim().slice(0, 200) });
  }
  return out;
}

function findScores(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(xml|musicxml|mxl)$/i.test(f) && !/\.opus\./i.test(f)) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];

export async function omrRun(args: { input: string; outDir: string }, send: Send): Promise<{ mxl: string[]; log: string; issues: OmrIssue[]; ms: number }> {
  const exe = exePath();
  if (!existsSync(exe)) throw new Error('Audiveris is not installed yet.');
  mkdirSync(args.outDir, { recursive: true });
  const t0 = Date.now();
  let log = '';
  await new Promise<void>((resolve, reject) => {
    const p = spawn(exe, ['-batch', '-export', '-output', args.outDir, '-constant', 'org.audiveris.omr.sheet.BookManager.useCompression=false', '--', args.input], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    belowNormal(p);
    proc = p;
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      log = (log + s).slice(-400000);
      const step = STEPS.findLast((x) => s.includes(x));
      if (step) send('ml-progress', { kind: 'omr', stage: 'reading the score: ' + step.toLowerCase(), done: STEPS.indexOf(step) + 1, total: STEPS.length });
    };
    p.stdout!.on('data', onData);
    p.stderr!.on('data', onData);
    p.on('error', reject);
    p.on('exit', (code, sig) => {
      proc = null;
      if (sig) reject(new Error('Cancelled'));
      else if (code !== 0 && !findScores(args.outDir).length) reject(new Error(`Audiveris stopped (exit ${code}). ${log.slice(-600)}`));
      else resolve();
    });
  });
  const mxl = findScores(args.outDir);
  if (!mxl.length) throw new Error('Audiveris found no music in this file. ' + log.slice(-400));
  return { mxl, log, issues: parseOmrLog(log), ms: Date.now() - t0 };
}

export function omrCancel() {
  abort?.abort();
  abort = null;
  proc?.kill();
  proc = null;
}
