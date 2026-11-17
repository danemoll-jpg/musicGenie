// .mgproj project files: JSON with a schemaVersion.
import type { Song } from './types';

// v2 (Round 2): song.playback, song.band, track.generated, track.derived, chordSymbols[].source.
// v3 (Round 3): song.backing, song.rocksmith, track.rocksmith, techniques.tremolo/slideToFret.
// v4 (Round 4): tempos[].ramp / rampTo (gradual tempo changes), song.chart (chord chart text).
// v5 (Round 5): song.mix (master + Reverb/Delay buses), mixer.fx / mixer.sends, track.automation,
//     track.audio (audio clips; media in <name>_media next to the project).
// v6 (Round 6): song.recording (which audio clip is the original recording), track.analysis
//     (stem / transcription tags), track.omr (pages/measures the sheet-music reader was unsure of).
// Older files load as-is (every addition is optional).
export const SCHEMA_VERSION = 6;

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
