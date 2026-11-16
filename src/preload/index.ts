import { contextBridge, ipcRenderer } from 'electron';

export interface Flags {
  mute: boolean;
  hidden: boolean;
  autosaveMs: number;
  open: string | null;
}

export interface AppSettings {
  soundFont: string | null;
  rocksmithDlc?: string | null;
  author?: string | null;
  /** Round 4: saved drum patterns (DrumPattern[]) and the last MIDI input. */
  drumPatterns?: unknown[];
  midiInput?: string | null;
  /** Round 5: user effect presets (FxPreset[]), audio input device, recording latency (ms). */
  fxPresets?: unknown[];
  audioInput?: string | null;
  latencyMs?: number;
}

// Read synchronously so the renderer knows about --mute before any audio code runs.
const flags: Flags = ipcRenderer.sendSync('flags');

const api = {
  flags,
  openDialog: (): Promise<string | null> => ipcRenderer.invoke('open-dialog'),
  readFile: (path: string): Promise<{ name: string; path: string; bytes: Uint8Array }> => ipcRenderer.invoke('read-file', path),
  saveProject: (json: string, path: string | null, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('save-project', { json, path, suggestedName }),
  autosave: (json: string): Promise<string> => ipcRenderer.invoke('autosave', json),
  recoveryOffer: (): Promise<{ savedAt: string; json: string } | null> => ipcRenderer.invoke('recovery-offer'),
  recoveryDismiss: (): Promise<void> => ipcRenderer.invoke('recovery-dismiss'),
  capture: (): Promise<Uint8Array> => ipcRenderer.invoke('capture'),
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke('settings-get'),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings-set', patch),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('file-exists', path),
  pickSoundFont: (): Promise<string | null> => ipcRenderer.invoke('pick-soundfont'),
  /** Run a Rocksmith helper command (read, readProject, readXml, write, check, findWwise, findRocksmith, list). */
  rs: <T = unknown>(cmd: string, args: unknown = {}): Promise<T> => ipcRenderer.invoke('rs', cmd, args),
  onRsProgress: (fn: (msg: string) => void): (() => void) => {
    const h = (_e: unknown, msg: string) => fn(msg);
    ipcRenderer.on('rs-progress', h);
    return () => ipcRenderer.removeListener('rs-progress', h);
  },
  writeBytes: (path: string, bytes: Uint8Array): Promise<string> => ipcRenderer.invoke('write-bytes', path, bytes),
  pickFile: (title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('pick-file', { title, filters }),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('pick-folder', title),
  paths: (): Promise<{ userData: string; documents: string; temp: string }> => ipcRenderer.invoke('paths'),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('reveal', path),
  // ----- Round 5 -----
  savePath: (suggestedName: string, ext: string, filterName: string): Promise<string | null> =>
    ipcRenderer.invoke('save-path', { suggestedName, ext, filterName }),
  copyInto: (src: string, dir: string): Promise<string> => ipcRenderer.invoke('copy-into', src, dir),
  pack: (args: { out: string; name: string; json: string; media: { file: string; as: string }[] }): Promise<{ path: string; entries: number; bytes: number }> =>
    ipcRenderer.invoke('pack', args),
  unpack: (path: string): Promise<string> => ipcRenderer.invoke('unpack', path),
  printPdf: (args: { out: string; job: Record<string, unknown> & { pageSize: 'Letter' | 'A4' }; pngOut?: string }): Promise<{ path: string; bytes: number; pages: number; png: string | null }> =>
    ipcRenderer.invoke('print-pdf', args),
  printJob: (): Promise<unknown> => ipcRenderer.invoke('print-job'),
  printReady: (): void => ipcRenderer.send('print-ready'),
};

export type MgApi = typeof api;

contextBridge.exposeInMainWorld('mg', api);
