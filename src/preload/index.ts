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
};

export type MgApi = typeof api;

contextBridge.exposeInMainWorld('mg', api);
