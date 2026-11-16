import { parseProject } from '../model/project';
import type { Song } from '../model/types';
import { importWithAlphaTab } from './fromAlphaTab';
import { importMidi } from './midiImport';

export const SUPPORTED_EXTENSIONS = [
  'mgproj', 'musicxml', 'xml', 'mxl', 'gp', 'gp3', 'gp4', 'gp5', 'gpx', 'mid', 'midi',
];

export type FileKind = 'project' | 'midi' | 'alphatab';

export function kindForFile(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'mgproj') return 'project';
  if (ext === 'mid' || ext === 'midi') return 'midi';
  return 'alphatab';
}

/** Open any supported file into our model. */
export function importFile(name: string, bytes: Uint8Array): Song {
  const kind = kindForFile(name);
  if (kind === 'project') return parseProject(new TextDecoder().decode(bytes));
  if (kind === 'midi') return importMidi(bytes, name.split(/[\\/]/).pop());
  return importWithAlphaTab(bytes);
}
