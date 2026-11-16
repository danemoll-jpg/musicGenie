// Item 3 check: one file of each type; track, measure and note counts match the source.
import * as alphaTab from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { midiSourceCounts } from '../../src/import/midiImport';
import { countNoteOnsets } from '../../src/model';
import { readTestFile, TEST_DATA } from './helpers';

function modelCounts(name: string) {
  const song = importFile(name, readTestFile(name));
  const measures = new Set(song.tracks.flatMap((t) => t.staves.map((s) => s.measures.length)));
  return { song, tracks: song.tracks.length, bars: song.bars.length, measures, notes: countNoteOnsets(song) };
}

describe('MusicXML import (independent XML count)', () => {
  it('ode-to-joy-piano.musicxml', () => {
    const xml = readFileSync(join(TEST_DATA, 'ode-to-joy-piano.musicxml'), 'utf8');
    const parts = (xml.match(/<score-part /g) ?? []).length;
    const measures = (xml.match(/<measure /g) ?? []).length / parts;
    const notes = (xml.match(/<note>[\s\S]*?<\/note>/g) ?? []).filter(
      (n) => !n.includes('<rest') && !n.includes('<tie type="stop"'),
    ).length;
    const c = modelCounts('ode-to-joy-piano.musicxml');
    console.log(`MusicXML: source tracks=${parts} measures=${measures} notes=${notes} | model tracks=${c.tracks} measures=${c.bars} notes=${c.notes}`);
    expect(c.tracks).toBe(parts);
    expect(c.bars).toBe(measures);
    expect([...c.measures]).toEqual([measures]);
    expect(c.notes).toBe(notes);
    expect(c.song.tracks[0].staves.length).toBe(2); // both hands
  });
});

describe('Guitar Pro import (counts vs alphaTab parse of the file)', () => {
  for (const f of ['full-song.gp', 'hammer.gp5', 'notes.gp3']) {
    it(f, () => {
      const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(readTestFile(f), new alphaTab.Settings());
      let notes = 0;
      for (const t of score.tracks)
        for (const s of t.staves)
          for (const b of s.bars)
            for (const v of b.voices) for (const bt of v.beats) notes += bt.notes.filter((n) => !n.isTieDestination).length;
      const c = modelCounts(f);
      console.log(`GP ${f}: source tracks=${score.tracks.length} measures=${score.masterBars.length} notes=${notes} | model tracks=${c.tracks} measures=${c.bars} notes=${c.notes}`);
      expect(c.tracks).toBe(score.tracks.length);
      expect(c.bars).toBe(score.masterBars.length);
      expect(c.notes).toBe(notes);
    });
  }
});

describe('MIDI import (counts vs @tonejs/midi)', () => {
  it('bach-prelude-c-bwv846.mid', () => {
    const src = midiSourceCounts(readTestFile('bach-prelude-c-bwv846.mid'));
    const c = modelCounts('bach-prelude-c-bwv846.mid');
    console.log(`MIDI: source tracks=${src.tracks} measures=${src.measures} notes=${src.notes} | model tracks=${c.tracks} measures=${c.bars} notes=${c.notes}`);
    expect(c.tracks).toBe(src.tracks);
    expect(c.bars).toBe(src.measures);
    expect(c.notes).toBe(src.notes);
  });
});
