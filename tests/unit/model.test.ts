import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import {
  allNotes, assignChord, countNoteOnsets, durationTicks, History, parseProject, ProjectLoadError,
  SCHEMA_VERSION, serializeProject, setDisplay, setInstrument, setMixer, transpose, transposeChordName,
  transposeFifths, type Song,
} from '../../src/model';
import { readTestFile } from './helpers';

function guitarSong(): Song {
  return importFile('full-song.gp', readTestFile('full-song.gp'));
}
function pianoSong(): Song {
  return importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
}

describe('durations', () => {
  it('computes ticks', () => {
    expect(durationTicks({ base: 4, dots: 0 })).toBe(960);
    expect(durationTicks({ base: 4, dots: 1 })).toBe(1440);
    expect(durationTicks({ base: 8, dots: 0, tuplet: { num: 3, den: 2 } })).toBe(320);
  });
});

describe('model carries guitar data', () => {
  it('imports string, fret and techniques from Guitar Pro', () => {
    const song = importFile('hammer.gp5', readTestFile('hammer.gp5'));
    const t = song.tracks[0];
    expect(t.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    const notes = allNotes(song);
    expect(notes.every((n) => n.string !== undefined && n.fret !== undefined)).toBe(true);
    expect(notes.some((n) => n.techniques?.hammerOn || n.techniques?.pullOff)).toBe(true);
    for (const n of notes) expect(n.pitch).toBe(t.tuning![n.string! - 1] + n.fret!);
  });
  it('imports tempo map, sections and chord symbols', () => {
    const song = guitarSong();
    expect(song.tempos[0]).toMatchObject({ bar: 0, tick: 0 });
    expect(song.tempos[0].bpm).toBeGreaterThan(0);
    expect(song.sections.length).toBeGreaterThan(0);
    const piano = pianoSong();
    expect(piano.chordSymbols.length).toBeGreaterThan(0);
    expect(piano.tracks[0].staves.length).toBe(2);
    const lyrics = piano.tracks[0].staves[0].measures[0].voices[0].beats.map((b) => b.lyric);
    expect(lyrics[0]).toBe('Joy');
  });
});

describe('.mgproj save/load', () => {
  it('round-trips deep-equal for every test file', () => {
    for (const f of ['full-song.gp', 'ode-to-joy-piano.musicxml', 'bach-prelude-c-bwv846.mid', 'hammer.gp5']) {
      const song = importFile(f, readTestFile(f));
      const text = serializeProject(song);
      expect(JSON.parse(text).schemaVersion).toBe(SCHEMA_VERSION);
      const reopened = parseProject(text);
      expect(reopened).toStrictEqual(song);
      // And through the generic importer, as the app opens it.
      expect(importFile('x.mgproj', new TextEncoder().encode(text))).toStrictEqual(song);
    }
  });
  it('rejects a future schema version with a clear message', () => {
    const text = serializeProject(pianoSong()).replace(`"schemaVersion": ${SCHEMA_VERSION}`, '"schemaVersion": 99');
    expect(() => parseProject(text)).toThrow(ProjectLoadError);
    expect(() => parseProject(text)).toThrow(/newer version of musicGenie.*v99/);
  });
  it('rejects non-projects', () => {
    expect(() => parseProject('not json')).toThrow(/not a musicGenie project/);
    expect(() => parseProject('{"a":1}')).toThrow(/no schemaVersion/);
  });
});

describe('instrument changes never touch notes', () => {
  it('piano -> electric guitar keeps every note identical', () => {
    const song = pianoSong();
    const before = structuredClone(song.tracks[0].staves);
    const next = setInstrument(song, song.tracks[0].id, 'electric-guitar-clean');
    expect(next.tracks[0].instrument).toEqual({ id: 'electric-guitar-clean', program: 27, percussion: false });
    expect(next.tracks[0].tuning).toEqual([40, 45, 50, 55, 59, 64]);
    expect(next.tracks[0].staves).toStrictEqual(before);
    expect(song.tracks[0].instrument.id).toBe('acoustic-grand-piano'); // input not mutated
  });
});

describe('transpose', () => {
  it('+2 raises every pitch by 2 and keeps frets playable', () => {
    const song = guitarSong();
    const up = transpose(song, 2);
    const a = allNotes(song);
    const b = allNotes(up);
    expect(b.length).toBe(a.length);
    const drumTrackNotes = new Set(
      song.tracks.filter((t) => t.instrument.percussion).flatMap((t) => t.staves.flatMap((s) => s.measures.flatMap((m) => m.voices.flatMap((v) => v.beats.flatMap((x) => x.notes))))),
    );
    let checked = 0;
    a.forEach((n, i) => {
      if (drumTrackNotes.has(n)) return;
      expect(b[i].pitch).toBe(Math.min(127, n.pitch + 2));
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
    for (const t of up.tracks) {
      if (!t.tuning) continue;
      for (const s of t.staves) for (const m of s.measures) for (const v of m.voices) for (const bt of v.beats) {
        const strings = new Set<number>();
        for (const n of bt.notes) {
          if (n.string === undefined) continue;
          expect(n.fret!).toBeGreaterThanOrEqual(0);
          expect(n.fret!).toBeLessThanOrEqual(24);
          expect(t.tuning[n.string - 1] + n.fret!).toBe(n.pitch);
          expect(strings.has(n.string)).toBe(false);
          strings.add(n.string);
        }
      }
    }
  });
  it('moves notes to other strings when the fret would go below the nut', () => {
    const song = importFile('hammer.gp5', readTestFile('hammer.gp5'));
    const down = transpose(song, -5);
    const t = down.tracks[0];
    for (const n of allNotes(down)) {
      expect(n.fret).toBeGreaterThanOrEqual(0);
      expect(t.tuning![n.string! - 1] + n.fret!).toBe(n.pitch);
    }
  });
  it('one track only leaves the others alone', () => {
    const song = guitarSong();
    const id = song.tracks[3].id;
    const up = transpose(song, 2, id);
    expect(up.tracks[0]).toStrictEqual(song.tracks[0]);
    expect(up.bars).toStrictEqual(song.bars);
  });
  it('transposes keys and chord names', () => {
    expect(transposeFifths(0, 2)).toBe(2); // C -> D
    expect(transposeFifths(-1, 2)).toBe(1); // F -> G
    expect(transposeChordName('Am7/G', 2, false)).toBe('Bm7/A');
    const piano = transpose(pianoSong(), 2);
    expect(piano.bars[0].key.fifths).toBe(2);
    expect(piano.chordSymbols[0].name.startsWith('D')).toBe(true);
  });
});

describe('fretting', () => {
  it('places a C major chord on separate strings', () => {
    const pos = assignChord([48, 52, 55, 60, 64], [40, 45, 50, 55, 59, 64]);
    const strings = pos.map((p) => p!.string);
    expect(new Set(strings).size).toBe(5);
    pos.forEach((p, i) => expect([40, 45, 50, 55, 59, 64][p!.string - 1] + p!.fret).toBe([48, 52, 55, 60, 64][i]));
  });
});

describe('undo / redo', () => {
  it('undoes and redoes instrument, transpose and track settings', () => {
    const s0 = pianoSong();
    const h = new History(s0);
    const id = s0.tracks[0].id;
    const s1 = h.apply(setInstrument(h.present, id, 'electric-guitar-clean'), 'Instrument');
    const s2 = h.apply(transpose(h.present, 2), 'Transpose');
    const s3 = h.apply(setMixer(h.present, id, { volume: 0.3, mute: true, pan: -0.5 }), 'Mixer');
    const s4 = h.apply(setDisplay(h.present, id, { mode: 'tab' }), 'Display');
    expect(h.undo()).toBe(s3);
    expect(h.undo()).toBe(s2);
    expect(h.undo()).toBe(s1);
    expect(h.undo()).toBe(s0);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(s1);
    expect(h.redo()).toBe(s2);
    // A new edit clears redo.
    const s2b = h.apply(setMixer(h.present, id, { solo: true }), 'Solo');
    expect(h.canRedo).toBe(false);
    expect(h.present).toBe(s2b);
    expect(s4.tracks[0].display.mode).toBe('tab');
    expect(s0.tracks[0].mixer.volume).not.toBe(0.3); // snapshots are independent
  });
});

describe('counts', () => {
  it('counts onsets excluding ties', () => {
    expect(countNoteOnsets(pianoSong())).toBeGreaterThan(0);
  });
});
