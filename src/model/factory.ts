import { instrumentForProgram } from './instruments';
import { restMeasure } from './noteEdit';
import type { BarHeader, Measure, Song, Staff, Track } from './types';

export function emptySong(title = 'Untitled'): Song {
  return {
    title, artist: '', album: '', composer: '',
    bars: [], tempos: [{ bar: 0, tick: 0, bpm: 120 }], sections: [], chordSymbols: [], tracks: [],
  };
}

export function defaultBar(): BarHeader {
  return { timeSignature: { numerator: 4, denominator: 4 }, key: { fifths: 0, mode: 'major' } };
}

export function emptyMeasure(): Measure {
  return { voices: [{ beats: [] }] };
}

export function newTrack(id: string, name: string, program: number, percussion: boolean, staves: Staff[]): Track {
  const c = instrumentForProgram(program, percussion);
  const track: Track = {
    id, name,
    instrument: { id: c.id, program: percussion ? 0 : program, percussion },
    mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
    display: { visible: true, mode: 'notation' },
    staves,
  };
  if (c.tuning) {
    track.tuning = [...c.tuning];
    track.displayTranspose = c.displayTranspose ?? 0;
    track.display.mode = 'both';
  }
  return track;
}

/** A new, empty song with one guitar or bass track: `bars` bars of 4/4 rests at 120 bpm. */
export function newSong(kind: 'guitar' | 'bass', bars = 8): Song {
  const song = emptySong('Untitled');
  song.bars = Array.from({ length: bars }, () => defaultBar());
  const program = kind === 'bass' ? 33 : 27;
  const t = newTrack('t1', kind === 'bass' ? 'Bass' : 'Guitar', program, false, [
    { clef: kind === 'bass' ? 'bass' : 'treble', measures: song.bars.map((b) => restMeasure(b)) },
  ]);
  t.display.mode = kind === 'bass' ? 'tab' : 'both';
  song.tracks.push(t);
  return song;
}
