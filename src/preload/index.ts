import { contextBridge, ipcRenderer } from 'electron';

export interface Flags {
  mute: boolean;
  hidden: boolean;
  autosaveMs: number;
  open: string | null;
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
  settingsGet: (): Promise<{ soundFont: string | null }> => ipcRenderer.invoke('settings-get'),
  settingsSet: (patch: { soundFont?: string | null }): Promise<{ soundFont: string | null }> => ipcRenderer.invoke('settings-set', patch),
  fileExists: (path: string): Promise<boolean> => ipcRenderer.invoke('file-exists', path),
  pickSoundFont: (): Promise<string | null> => ipcRenderer.invoke('pick-soundfont'),
};

export type MgApi = typeof api;

contextBridge.exposeInMainWorld('mg', api);
