// Electron main process: window, files, autosave/recovery, test flags.
//
// Command-line flags:
//   --mute             master volume is 0 from the very first audio node (renderer master bus).
//   --hidden           window is never shown or focused (tests); also exposes window.mgTest.
//   --profile-dir=DIR  use DIR for app data (tests use a throwaway folder).
//   --autosave-ms=N    autosave interval (default 120000 = 2 minutes).
//   --open=FILE        open FILE on start-up.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';
import { unzipStore, zipStore } from './zip';
import { RocksmithHelper } from './rocksmithHelper';
import { pathToFileURL } from 'node:url';

function flagValue(name: string): string | undefined {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit?.slice(pre.length);
}

const flags = {
  mute: process.argv.includes('--mute'),
  hidden: process.argv.includes('--hidden'),
  autosaveMs: Number(flagValue('autosave-ms') ?? 120000) || 120000,
  open: flagValue('open') ?? null,
};

const profileDir = flagValue('profile-dir');
if (profileDir) app.setPath('userData', profileDir);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const rendererDir = join(__dirname, '..', 'renderer');

// ---------- app settings (userData/settings.json) ----------
interface AppSettings {
  /** User SoundFont path, or null for the bundled default. */
  soundFont: string | null;
  /** Rocksmith 2014 dlc folder chosen by the user (null = use the one found automatically). */
  rocksmithDlc?: string | null;
  /** Charter name written into exported Rocksmith songs. */
  author?: string | null;
  /** Saved drum-sequencer patterns and the last MIDI input (Round 4). */
  drumPatterns?: unknown[];
  midiInput?: string | null;
  /** Round 5: user effect presets, audio input device id, recording latency (ms). */
  fxPresets?: unknown[];
  audioInput?: string | null;
  latencyMs?: number;
}
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
function readSettings(): AppSettings {
  try {
    return { soundFont: null, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { soundFont: null };
  }
}
function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 1));
  return next;
}

// ---------- recovery ----------
const recoveryDir = () => join(app.getPath('userData'), 'recovery');
const lockFile = () => join(recoveryDir(), 'session.lock');
const autosaveFile = () => join(recoveryDir(), 'autosave.mgproj');
const pendingFile = () => join(recoveryDir(), 'previous-session.mgproj');
let recoveryOffer: { path: string; savedAt: string } | null = null;

function initRecovery() {
  mkdirSync(recoveryDir(), { recursive: true });
  // A leftover lock means the last session did not quit cleanly.
  if (existsSync(lockFile()) && existsSync(autosaveFile())) {
    renameSync(autosaveFile(), pendingFile());
  }
  if (existsSync(pendingFile())) {
    let savedAt = '';
    try {
      savedAt = JSON.parse(readFileSync(lockFile(), 'utf8')).lastAutosave ?? '';
    } catch {
      /* lock unreadable: still offer */
    }
    recoveryOffer = { path: pendingFile(), savedAt };
  }
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
}

function cleanExit() {
  try {
    rmSync(autosaveFile(), { force: true });
    rmSync(lockFile(), { force: true });
  } catch {
    /* ignore */
  }
}

// ---------- window ----------
let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    skipTaskbar: flags.hidden,
    focusable: !flags.hidden,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#f6f5f2',
    title: 'musicGenie',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: !flags.hidden,
      autoplayPolicy: 'no-user-gesture-required',
      // Hidden test runs render off-screen: no OS window is ever shown, yet the page keeps
      // painting so capturePage() screenshots are current.
      offscreen: flags.hidden,
    },
  });
  if (flags.hidden) win.webContents.setFrameRate(30);
  if (!flags.hidden) win.once('ready-to-show', () => win?.show());

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadURL('app://musicgenie/index.html');
}

// ---------- IPC ----------
ipcMain.on('flags', (e) => {
  e.returnValue = flags;
});

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [
      { name: 'Music files', extensions: ['mgproj', 'mgpack', 'musicxml', 'xml', 'mxl', 'gp', 'gp3', 'gp4', 'gp5', 'gpx', 'mid', 'midi', 'psarc', 'rs2dlc'] },
      { name: 'Rocksmith 2014 (.psarc, DLC Builder .rs2dlc, arrangement .xml)', extensions: ['psarc', 'rs2dlc', 'xml'] },
      { name: 'musicGenie package (project + audio)', extensions: ['mgpack'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('settings-get', () => readSettings());
ipcMain.handle('settings-set', (_e, patch: Partial<AppSettings>) => writeSettings(patch));
ipcMain.handle('file-exists', (_e, path: string) => !!path && existsSync(path));
ipcMain.handle('pick-soundfont', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Load SoundFont',
    properties: ['openFile'],
    filters: [{ name: 'SoundFont', extensions: ['sf2', 'sf3'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('read-file', (_e, path: string) => {
  const buf = readFileSync(path);
  return { name: basename(path), path, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
});

ipcMain.handle('save-project', async (_e, args: { json: string; path: string | null; suggestedName: string }) => {
  let path = args.path;
  if (!path) {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: args.suggestedName.replace(/[\\/:*?"<>|]/g, '_') + '.mgproj',
      filters: [{ name: 'musicGenie project', extensions: ['mgproj'] }],
    });
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  const tmp = path + '.tmp';
  writeFileSync(tmp, args.json, 'utf8');
  renameSync(tmp, path);
  return path;
});

ipcMain.handle('autosave', (_e, json: string) => {
  mkdirSync(recoveryDir(), { recursive: true });
  const tmp = autosaveFile() + '.tmp';
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, autosaveFile());
  const savedAt = new Date().toISOString();
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, lastAutosave: savedAt }));
  return savedAt;
});

ipcMain.handle('recovery-offer', () => {
  if (!recoveryOffer) return null;
  try {
    return { savedAt: recoveryOffer.savedAt, json: readFileSync(recoveryOffer.path, 'utf8') };
  } catch {
    return null;
  }
});

ipcMain.handle('recovery-dismiss', () => {
  if (recoveryOffer) rmSync(recoveryOffer.path, { force: true });
  recoveryOffer = null;
});

// ---------- Rocksmith helper + files ----------
const rocksmith = new RocksmithHelper((msg) => win?.webContents.send('rs-progress', msg));
ipcMain.handle('rs', (_e, cmd: string, args: unknown) => rocksmith.request(cmd, args));

ipcMain.handle('write-bytes', (_e, path: string, bytes: Uint8Array) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
});

ipcMain.handle('pick-file', async (_e, opts: { title: string; filters: { name: string; extensions: string[] }[] }) => {
  const r = await dialog.showOpenDialog(win!, { title: opts.title, properties: ['openFile'], filters: opts.filters });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-folder', async (_e, title: string) => {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('paths', () => ({
  userData: app.getPath('userData'),
  documents: app.getPath('documents'),
  temp: app.getPath('temp'),
}));

ipcMain.handle('reveal', (_e, path: string) => shell.showItemInFolder(path));

// ---------- Round 5: media folder, .mgpack, save paths, PDF printing ----------
ipcMain.handle('save-path', async (_e, args: { suggestedName: string; ext: string; filterName: string }) => {
  const r = await dialog.showSaveDialog(win!, {
    defaultPath: args.suggestedName.replace(/[\\/:*?"<>|]/g, '_') + '.' + args.ext,
    filters: [{ name: args.filterName, extensions: [args.ext] }],
  });
  return r.canceled || !r.filePath ? null : r.filePath;
});

/** Copy a file into a folder (kept if the same file is already there); returns the copy's path. */
ipcMain.handle('copy-into', (_e, src: string, dir: string) => {
  mkdirSync(dir, { recursive: true });
  const base = basename(src);
  let dest = join(dir, base);
  if (normalize(dest).toLowerCase() === normalize(src).toLowerCase()) return dest;
  const size = statSync(src).size;
  for (let k = 2; existsSync(dest); k++) {
    if (statSync(dest).size === size) return dest;
    dest = join(dir, base.replace(/(\.[^.]+)?$/, '-' + k + '$1'));
  }
  copyFileSync(src, dest);
  return dest;
});

/** .mgpack = ZIP of the project (<name>.mgproj) and its media (<name>_media/...). */
ipcMain.handle('pack', (_e, args: { out: string; name: string; json: string; media: { file: string; as: string }[] }) => {
  const entries = [{ name: args.name + '.mgproj', data: new Uint8Array(Buffer.from(args.json, 'utf8')) }];
  for (const m of args.media) {
    const b = readFileSync(m.file);
    entries.push({ name: args.name + '_media/' + m.as, data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) });
  }
  writeFileSync(args.out, zipStore(entries));
  return { path: args.out, entries: entries.length, bytes: statSync(args.out).size };
});

/** Unpack a .mgpack into userData/packages/<name>/ and return the project path inside. */
ipcMain.handle('unpack', (_e, path: string) => {
  const entries = unzipStore(readFileSync(path));
  const dir = join(app.getPath('userData'), 'packages', basename(path).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') + '-' + Date.now().toString(36));
  let project: string | null = null;
  for (const e of entries) {
    const dest = normalize(join(dir, e.name));
    if (!dest.startsWith(normalize(dir))) throw new Error('Bad entry in package: ' + e.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
    if (!project && e.name.toLowerCase().endsWith('.mgproj') && !e.name.includes('/')) project = dest;
  }
  if (!project) throw new Error('This package has no project file.');
  return project;
});

// Printing: a hidden window (never shown, not focusable) renders the score pages, then printToPDF.
let printJob: unknown = null;
let printReady: (() => void) | null = null;
ipcMain.handle('print-job', () => printJob);
ipcMain.on('print-ready', () => printReady?.());
ipcMain.handle('print-pdf', async (_e, args: { out: string; job: { pageSize: 'Letter' | 'A4' } & Record<string, unknown>; pngOut?: string }) => {
  printJob = args.job;
  const pw = new BrowserWindow({
    width: args.job.pageSize === 'A4' ? 794 : 816, height: 1100, show: false, focusable: false, skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { preload: join(__dirname, '..', 'preload', 'index.js'), sandbox: false, contextIsolation: true, offscreen: true },
  });
  try {
    const ready = new Promise<void>((resolve, reject) => {
      printReady = resolve;
      setTimeout(() => reject(new Error('The score did not finish rendering for printing.')), 60000);
    });
    const base = process.env.ELECTRON_RENDERER_URL ?? 'app://musicgenie/index.html';
    await pw.loadURL(base + (base.includes('?') ? '&' : '?') + 'print=1');
    await ready;
    let png: string | null = null;
    if (args.pngOut) {
      const img = await pw.webContents.capturePage();
      writeFileSync(args.pngOut, img.toPNG());
      png = args.pngOut;
    }
    const pdf = await pw.webContents.printToPDF({
      pageSize: args.job.pageSize,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#555"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
    });
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    return { path: args.out, bytes: pdf.length, pages, png };
  } finally {
    printReady = null;
    printJob = null;
    pw.destroy();
  }
});

/** PNG of the window (works while hidden; never shows or focuses it). */
ipcMain.handle('capture', async () => {
  const img = await win!.webContents.capturePage();
  return img.toPNG();
});

// ---------- app ----------
app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = normalize(join(rendererDir, rel));
    if (!file.startsWith(normalize(rendererDir))) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  initRecovery();
  createWindow();
});

app.on('window-all-closed', () => {
  cleanExit();
  app.quit();
});
app.on('before-quit', () => {
  rocksmith.stop();
  cleanExit();
});

