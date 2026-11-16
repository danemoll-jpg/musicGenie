// .mgproj project files: JSON with a schemaVersion.
import type { Song } from './types';

export const SCHEMA_VERSION = 1;

export interface ProjectFile {
  schemaVersion: number;
  app: 'musicGenie';
  song: Song;
}

export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export function serializeProject(song: Song): string {
  const file: ProjectFile = { schemaVersion: SCHEMA_VERSION, app: 'musicGenie', song };
  return JSON.stringify(file, null, 1);
}

export function parseProject(text: string): Song {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectLoadError('This file is not a musicGenie project (it is not valid JSON).');
  }
  if (!data || typeof data !== 'object') throw new ProjectLoadError('This file is not a musicGenie project.');
  const d = data as Partial<ProjectFile>;
  if (typeof d.schemaVersion !== 'number') {
    throw new ProjectLoadError('This file is not a musicGenie project (no schemaVersion).');
  }
  if (d.schemaVersion > SCHEMA_VERSION) {
    throw new ProjectLoadError(
      `This project was saved by a newer version of musicGenie (project format v${d.schemaVersion}). ` +
        `This version can only open format v${SCHEMA_VERSION} or older. Please update musicGenie to open it.`,
    );
  }
  if (d.schemaVersion < 1) throw new ProjectLoadError(`Unknown project format v${d.schemaVersion}.`);
  const song = d.song as Song | undefined;
  if (!song || !Array.isArray(song.tracks) || !Array.isArray(song.bars)) {
    throw new ProjectLoadError('This project file is damaged (missing song, tracks or bars).');
  }
  for (const t of song.tracks) {
    if (!Array.isArray(t.staves) || t.staves.some((s) => s.measures.length !== song.bars.length)) {
      throw new ProjectLoadError(`This project file is damaged (track "${t.name}" has the wrong number of measures).`);
    }
  }
  return song;
}
