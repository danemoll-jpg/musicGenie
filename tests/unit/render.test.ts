// Model -> alphaTab Score -> model keeps pitches, strings, frets and techniques.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { fromAlphaTabScore } from '../../src/import/fromAlphaTab';
import { allNotes, setInstrument } from '../../src/model';
import { toAlphaTabScore } from '../../src/render/toAlphaTab';
import { readTestFile } from './helpers';

describe('toAlphaTabScore', () => {
  for (const f of ['full-song.gp', 'ode-to-joy-piano.musicxml', 'bach-prelude-c-bwv846.mid', 'hammer.gp5']) {
    it(`round-trips notes for ${f}`, () => {
      const song = importFile(f, readTestFile(f));
      const score = toAlphaTabScore(song, new alphaTab.Settings());
      expect(score.masterBars.length).toBe(song.bars.length);
      const back = fromAlphaTabScore(score);
      const a = allNotes(song);
      const b = allNotes(back);
      expect(b.length).toBe(a.length);
      a.forEach((n, i) => {
        if (song.tracks.some((t) => t.instrument.percussion)) return;
        expect(b[i].pitch).toBe(n.pitch);
        expect(b[i].string).toBe(n.string);
        expect(b[i].fret).toBe(n.fret);
        expect(!!b[i].tieFromPrevious).toBe(!!n.tieFromPrevious);
        expect(b[i].techniques?.hammerOn).toBe(n.techniques?.hammerOn);
        expect(b[i].techniques?.pullOff).toBe(n.techniques?.pullOff);
      });
      expect(back.tempos[0].bpm).toBe(song.tempos[0].bpm);
    });
  }
  it('shows a piano part as guitar tab without changing the notes', () => {
    const song = importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
    const g = setInstrument(song, 't1', 'electric-guitar-clean');
    const score = toAlphaTabScore(g, new alphaTab.Settings());
    expect(score.tracks[0].playbackInfo.program).toBe(27);
    const notes = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    expect(notes[0].isStringed).toBe(true);
    expect(notes[0].realValue).toBe(song.tracks[0].staves[0].measures[0].voices[0].beats[0].notes[0].pitch);
  });
});
