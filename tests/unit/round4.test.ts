// Round 4: piano roll, chord explorer, progressions, drum grid, chord charts + song-wide
// changes, harmony lines, MIDI recording, save/load + undo.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import {
  addHarmonyTrack, addRollNote, applyPattern, barStartTicks, barTicks, BUILTIN_PATTERNS, chartToSong, chordNotes, chordPcs,
  copyDrumBar, defaultBand, deleteRollNotes, durationTicks, fillSection, fixedTempoClock, fretVoicings, generateBand,
  harmonize, History, insertChordBars, keyOfBar, melodyLine, mergeTake, MidiRecorder, moveRollNotes, msAtTick, newSong,
  newTrack, parseChart, parseChordSpec, parseProject, pianoVoicings, PROGRESSIONS, progressionChords, quantizeNotes,
  readDrumBar, removeKeyChange, removeTempoChange, resizeRollNotes, restMeasure, scalePcs, serializeProject, setBeatPitches,
  setCapo, setDrumStep, setKeyAt, setRollVelocity, setTempoAt, setTempoRamp, setTimeSignatureAt, songLengthMs, specName,
  splitTicks, staffNotes, substitutions, suggestNext, tempoChanges, tempoPoints, trackEvents, emptySong, defaultBar,
  hashOf, GUITAR_STANDARD, rocksmithArrangement, type Song,
} from '../../src/model';
import { toAlphaTabScore } from '../../src/render/toAlphaTab';
import { readTestFile } from './helpers';

const ode = (): Song => importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
const DROP_D = [38, 45, 50, 55, 59, 64];
const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** Every voice of every bar is exactly one bar long. */
function barsFull(song: Song) {
  for (const t of song.tracks)
    for (const st of t.staves)
      st.measures.forEach((m, bi) => {
        for (const v of m.voices) {
          if (!v.beats.length) continue;
          const len = v.beats.reduce((a, b) => a + (b.grace ? 0 : durationTicks(b.duration)), 0);
          expect(len, `${t.name} bar ${bi + 1}`).toBe(barTicks(song.bars[bi]));
        }
      });
}

/** Notes as alphaTab draws/plays them: [start tick, pitch, string, fret] (fret from the nut). */
function alphaTabNotes(song: Song, ti: number) {
  const score = toAlphaTabScore(song, new alphaTab.Settings());
  const out: [number, number, number | null, number | null][] = [];
  const capo = song.tracks[ti].capo ?? 0;
  for (const staff of score.tracks[ti].staves)
    for (const bar of staff.bars)
      for (const v of bar.voices)
        for (const b of v.beats)
          for (const n of b.notes) {
            if (n.isTieDestination) continue;
            out.push([b.absolutePlaybackStart, n.realValue, n.isStringed ? n.string : null, n.isStringed ? n.fret + capo : null]);
          }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('splitTicks with triplets', () => {
  it('keeps straight lengths plain and writes triplet lengths as triplets', () => {
    expect(splitTicks(960)).toEqual([{ base: 4, dots: 0 }]);
    const t = splitTicks(320, 0);
    expect(t).toEqual([{ base: 8, dots: 0, tuplet: { num: 3, den: 2 } }]);
    const sum = (ds: ReturnType<typeof splitTicks>) => ds.reduce((a, d) => a + durationTicks(d), 0);
    expect(sum(splitTicks(3200, 640))).toBe(3200);
  });
});

describe('1. piano roll', () => {
  it('notes drawn in the roll are the same notes in the score and the tab (guitar)', () => {
    let s = newSong('guitar', 4);
    const drawn = [
      { start: 0, dur: 480, pitch: 64 }, { start: 480, dur: 480, pitch: 67 }, { start: 960, dur: 960, pitch: 69 },
      { start: 960, dur: 960, pitch: 52 }, // chord with a low note
      { start: 1920, dur: 320, pitch: 71 }, { start: 2240, dur: 320, pitch: 72 }, { start: 2560, dur: 320, pitch: 74 }, // triplet 8ths
      { start: 3840 - 480, dur: 960, pitch: 76 }, // crosses the barline (tied)
      { start: 3840 * 2, dur: 3840, pitch: 45, velocity: 120 },
    ];
    for (const d of drawn) s = addRollNote(s, 0, 0, d);
    barsFull(s);
    const ev = staffNotes(s, 0, 0);
    expect(ev.map((e) => [e.start, e.dur, e.pitch])).toEqual(
      [...drawn].sort((a, b) => a.start - b.start || a.pitch - b.pitch).map((d) => [d.start, d.dur, d.pitch]),
    );
    expect(ev.find((e) => e.pitch === 45)!.velocity).toBe(120);
    const t = s.tracks[0];
    for (const e of ev) {
      expect(e.string, `pitch ${e.pitch} has a string`).toBeDefined();
      expect(t.tuning![e.string! - 1] + e.fret!).toBe(e.pitch);
    }
    // Same notes as alphaTab builds them for the score + tab.
    const at = alphaTabNotes(s, 0);
    expect(at.map((n) => [n[0], n[1]])).toEqual(ev.map((e) => [e.start, e.pitch]));
    expect(at.map((n) => [n[2], n[3]])).toEqual(ev.map((e) => [e.string, e.fret]));
  });

  it('move, resize, velocity and delete edit only the touched bars', () => {
    let s = ode();
    const before = structuredClone(s);
    const ev0 = staffNotes(s, 0, 0);
    const idx = ev0.findIndex((e) => e.start >= barStartTicks(s)[2]);
    s = moveRollNotes(s, 0, 0, [idx], 0, 2);
    const moved = staffNotes(s, 0, 0);
    expect(moved.some((e) => e.start === ev0[idx].start && e.pitch === ev0[idx].pitch + 2)).toBe(true);
    // Untouched bars are identical objects-by-value.
    const bar = barStartTicks(s).findIndex((x, i, a) => ev0[idx].start >= x && (i + 1 >= a.length || ev0[idx].start < a[i + 1]));
    s.tracks[0].staves[0].measures.forEach((m, i) => {
      if (i !== bar) expect(m).toEqual(before.tracks[0].staves[0].measures[i]);
    });
    s = resizeRollNotes(s, 0, 0, [0], 1920);
    expect(staffNotes(s, 0, 0)[0].dur).toBe(1920);
    s = setRollVelocity(s, 0, 0, [0], 40);
    expect(staffNotes(s, 0, 0)[0].velocity).toBe(40);
    const n = staffNotes(s, 0, 0).length;
    s = deleteRollNotes(s, 0, 0, [0]);
    expect(staffNotes(s, 0, 0).length).toBe(n - 1);
    barsFull(s);
  });

  it('overlapping notes get their own voice; capo is respected', () => {
    let s = newSong('guitar', 2);
    s = setCapo(s, 't1', 3);
    s = addRollNote(s, 0, 0, { start: 0, dur: 3840, pitch: 55 });
    s = addRollNote(s, 0, 0, { start: 960, dur: 480, pitch: 67 });
    const m = s.tracks[0].staves[0].measures[0];
    expect(m.voices.length).toBe(2);
    for (const e of staffNotes(s, 0, 0)) expect(e.fret!).toBeGreaterThanOrEqual(3);
    expect(staffNotes(s, 0, 0).map((e) => [e.start, e.dur, e.pitch])).toEqual([[0, 3840, 55], [960, 480, 67]]);
    barsFull(s);
  });
});

describe('2. chord explorer', () => {
  const names = ['C', 'Am7', 'D/F#', 'E7#9'];
  for (const [tname, tuning] of [['standard', GUITAR_STANDARD], ['Drop D', DROP_D]] as const) {
    for (const name of names) {
      it(`${name} in ${tname}: every voicing's notes match the chord`, () => {
        const c = parseChordSpec(name)!;
        expect(specName(c)).toBe(name);
        const pcs = chordPcs(c);
        const req = chordNotes(c).required;
        const vs = fretVoicings(c, [...tuning], 0);
        expect(vs.length, 'some voicings').toBeGreaterThan(2);
        expect(vs.some((v) => v.kind === 'open' || v.kind === 'barre' || v.kind === 'shape')).toBe(true);
        for (const v of vs) {
          const sounding = v.frets.map((f, i) => (f === null ? null : tuning[i] + f)).filter((p): p is number => p !== null).sort((a, b) => a - b);
          expect(sounding, v.label).toEqual(v.pitches);
          for (const p of v.pitches) expect(pcs.has(mod12(p)), `${v.label}: ${p}`).toBe(true);
          if (v.kind === 'open' || v.kind === 'barre' || v.kind === 'shape') {
            expect(mod12(v.pitches[0]), `${v.label} bass`).toBe(c.bass);
            for (const r of req) expect(v.pitches.some((p) => mod12(p) === r), `${v.label} has ${r}`).toBe(true);
            expect(v.fingers.filter((f) => f !== null && f > 0).length <= 4 || !!v.barre).toBe(true);
          }
        }
        for (const v of pianoVoicings(c)) {
          for (const p of v.pitches) expect(pcs.has(mod12(p)), v.label).toBe(true);
          for (const r of req) expect(v.pitches.some((p) => mod12(p) === r), `${v.label} has ${r}`).toBe(true);
          if (c.bass !== c.root) expect(mod12(v.pitches[0])).toBe(c.bass);
        }
      });
    }
  }

  it('finds the usual shapes', () => {
    const key = (v: { frets: (number | null)[] }) => v.frets.map((f) => (f === null ? 'x' : f)).join('');
    const c = fretVoicings(parseChordSpec('C')!, GUITAR_STANDARD).map(key);
    expect(c).toContain('x32010');
    expect(fretVoicings(parseChordSpec('E7#9')!, GUITAR_STANDARD).map(key)).toContain('x7678x');
    expect(fretVoicings(parseChordSpec('Am7')!, GUITAR_STANDARD).map(key)).toContain('x02010');
    expect(fretVoicings(parseChordSpec('D/F#')!, GUITAR_STANDARD).map(key).some((k) => k.startsWith('2') && k.endsWith('232'))).toBe(true);
    // Drop D: the low string is D, so a D chord can use it as the bass.
    expect(fretVoicings(parseChordSpec('D')!, DROP_D).map(key)).toContain('000232');
    // Power chords and string-set triads are there too.
    const g = fretVoicings(parseChordSpec('G')!, GUITAR_STANDARD);
    expect(g.some((v) => v.kind === 'power' && key(v) === '355xxx')).toBe(true);
    expect(g.filter((v) => v.kind === 'triad').length).toBeGreaterThanOrEqual(6);
  });

  it('respects the capo (frets count from the nut)', () => {
    const vs = fretVoicings(parseChordSpec('D')!, GUITAR_STANDARD, 2);
    for (const v of vs) for (const f of v.frets) if (f !== null) expect(f).toBeGreaterThanOrEqual(2);
    expect(vs.some((v) => v.kind === 'open')).toBe(true);
  });

  it('bass shapes on a bass tuning', () => {
    const vs = fretVoicings(parseChordSpec('A')!, [28, 33, 38, 43]);
    expect(vs.some((v) => v.kind === 'bass')).toBe(true);
    for (const v of vs) for (const p of v.pitches) expect(chordPcs(parseChordSpec('A')!).has(mod12(p))).toBe(true);
  });

  it('parses common names', () => {
    for (const n of ['Cmaj7', 'F#m7b5', 'Bbmaj9', 'Gsus4', 'C6/9', 'A5', 'Ddim7', 'Ebaug', 'G13', 'Fadd9', 'C7b9', 'Am11']) {
      const c = parseChordSpec(n);
      expect(c, n).not.toBeNull();
      expect(parseChordSpec(specName(c!))).toEqual(c);
    }
    expect([...chordPcs(parseChordSpec('E7#9')!)].sort((a, b) => a - b)).toEqual([2, 4, 7, 8, 11]);
  });

  it('inserts a voicing at the cursor beat and sets the chord symbol', () => {
    const s = newSong('guitar', 2);
    const v = fretVoicings(parseChordSpec('C')!, GUITAR_STANDARD).find((x) => x.kind === 'open')!;
    const played = v.frets.map((f, i) => (f === null ? null : { string: i + 1, fret: f })).filter((x): x is { string: number; fret: number } => !!x);
    const s2 = setBeatPitches(s, { track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }, v.pitches, 96, played);
    const b = s2.tracks[0].staves[0].measures[0].voices[0].beats[0];
    expect(b.notes.map((n) => n.pitch)).toEqual(v.pitches);
    expect(b.notes.map((n) => `${n.string}:${n.fret}`)).toEqual(played.map((p) => `${p.string}:${p.fret}`));
    barsFull(s2);
  });
});

describe('3. progression helper', () => {
  it('suggests next chords in C major', () => {
    const s = emptySong();
    s.bars = [defaultBar()];
    const k = keyOfBar(s, 0);
    const next = suggestNext('C', k).filter((x) => x.kind === 'next').map((x) => x.name);
    expect(next).toEqual(['F', 'G', 'Am', 'Dm', 'Em']);
    expect(suggestNext('G', k).filter((x) => x.kind === 'next').map((x) => x.name)).toEqual(['C', 'Am', 'F']);
    const sec = suggestNext('C', k).filter((x) => x.kind === 'secondary').map((x) => x.name);
    expect(sec).toEqual(['A7', 'B7', 'C7', 'D7', 'E7']);
    const bor = suggestNext('C', k).filter((x) => x.kind === 'borrowed').map((x) => x.name);
    expect(bor).toEqual(['Fm', 'Ab', 'Bb', 'Eb', 'Ddim']);
    const subs = substitutions('G7', k);
    expect(subs.find((x) => x.kind === 'tritone')?.name).toBe('Db7');
    expect(substitutions('C', k).find((x) => x.kind === 'relative')?.name).toBe('Am');
  });

  it('suggests next chords in A minor', () => {
    const s = emptySong();
    s.bars = [{ ...defaultBar(), key: { fifths: 0, mode: 'minor' } }];
    const k = keyOfBar(s, 0);
    expect(k).toEqual({ tonic: 9, mode: 'minor' });
    expect(scalePcs(k)).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(suggestNext('Am', k).filter((x) => x.kind === 'next').map((x) => x.name)).toEqual(['Dm', 'E', 'F', 'G', 'Bdim']);
    expect(suggestNext('E', k).filter((x) => x.kind === 'next').map((x) => x.name)).toEqual(['Am', 'F']);
    expect(substitutions('Am', k).find((x) => x.kind === 'relative')?.name).toBe('C');
    expect(suggestNext('Am', k).filter((x) => x.kind === 'borrowed').map((x) => x.name)).toEqual(['D', 'A', 'A#']);
  });

  it('inserts a 12-bar blues in E over 12 bars', () => {
    let s = newSong('guitar', 12);
    s.bars.forEach((b) => (b.key = { fifths: 4, mode: 'major' }));
    const p = PROGRESSIONS.find((x) => x.id === 'blues12')!;
    s = insertChordBars(s, 0, 11, progressionChords(p, keyOfBar(s, 0)));
    expect(s.chordSymbols.map((c) => `${c.bar}:${c.tick}:${c.name}`)).toEqual(
      ['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7'].map((n, i) => `${i}:0:${n}`),
    );
    // A minor-key progression in a major song uses the relative minor.
    const and = progressionChords(PROGRESSIONS.find((x) => x.id === 'andalusian')!, { tonic: 0, mode: 'major' });
    expect(and.flat()).toEqual(['Am', 'G', 'F', 'E']);
    // Two chords in a bar split it.
    const s2 = insertChordBars(s, 0, 0, [['F', 'G']]);
    expect(s2.chordSymbols.filter((c) => c.bar === 0).map((c) => [c.tick, c.name])).toEqual([[0, 'F'], [1920, 'G']]);
  });
});

describe('4. drum step sequencer', () => {
  const drumSong = () => {
    const s = emptySong('Drums');
    s.bars = [defaultBar(), defaultBar(), defaultBar(), defaultBar()];
    s.tracks.push(newTrack('d', 'Drums', 0, true, [{ clef: 'neutral', measures: s.bars.map((b) => restMeasure(b)) }]));
    return s;
  };

  it('a pattern built in the grid matches the drum notation', () => {
    let s = drumSong();
    const hits: [number, number, number][] = [[36, 0, 96], [36, 8, 96], [36, 10, 96], [38, 4, 124], [38, 12, 96], [38, 15, 48]];
    for (let i = 0; i < 16; i += 2) hits.push([42, i, 96]);
    for (const [p, st, v] of hits) s = setDrumStep(s, 0, 1, 16, false, p, st, v);
    barsFull(s);
    const start = barStartTicks(s)[1];
    const ev = trackEvents(s, s.tracks[0]).map((e) => [e.start - start, e.pitch, e.velocity]);
    const want = hits.map(([p, st, v]) => [st * 240, p, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(ev).toEqual(want);
    // Read back = what was set.
    const g = readDrumBar(s, 0, 1, 16, false);
    expect(g.lanes.get(38)).toEqual([0, 0, 0, 0, 124, 0, 0, 0, 0, 0, 0, 0, 96, 0, 0, 48]);
    // alphaTab draws percussion articulations at the same positions.
    const score = toAlphaTabScore(s, new alphaTab.Settings());
    const at: number[][] = [];
    for (const v of score.tracks[0].staves[0].bars[1].voices)
      for (const b of v.beats) for (const n of b.notes) at.push([b.playbackStart, n.percussionArticulation]);
    expect(at.sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual(want.map((w) => [w[0], w[1]]));
    // Clear a step.
    s = setDrumStep(s, 0, 1, 16, false, 38, 15, 0);
    expect(readDrumBar(s, 0, 1, 16, false).lanes.get(38)![15]).toBe(0);
  });

  it('triplet grid, copy a bar, fill a section, patterns', () => {
    let s = drumSong();
    s = setDrumStep(s, 0, 0, 16, true, 51, 2, 96);
    expect(trackEvents(s, s.tracks[0]).map((e) => [e.start, e.pitch])).toEqual([[640, 51]]);
    s = copyDrumBar(s, 0, 0, [2]);
    expect(trackEvents(s, s.tracks[0]).map((e) => [e.start, e.pitch])).toEqual([[640, 51], [640 + 7680, 51]]);
    s.sections = [{ bar: 0, name: 'Verse' }];
    s = fillSection(s, 0, 0);
    expect(trackEvents(s, s.tracks[0]).length).toBe(4);
    const rock = BUILTIN_PATTERNS[0];
    s = applyPattern(s, 0, [3], rock);
    const g = readDrumBar(s, 0, 3, 16, false);
    expect(g.lanes.get(42)!.filter((v) => v > 0).length).toBe(8);
    barsFull(s);
  });

  it('editing a generated drum track marks it edited', () => {
    let s = ode();
    s = generateBand(s, defaultBand('rock', s.tracks[0].id, 3));
    const di = s.tracks.findIndex((t) => t.generated?.role === 'drums');
    expect(hashOf(s.tracks[di].staves)).toBe(s.tracks[di].generated!.contentHash);
    s = setDrumStep(s, di, 0, 16, false, 49, 0, 124);
    expect(hashOf(s.tracks[di].staves)).not.toBe(s.tracks[di].generated!.contentHash);
  });
});

describe('5. chord charts, key/time/tempo changes', () => {
  const CHART = `{key: G} {tempo: 100}
[Verse]
|: G | Em | C D | % :|
[Chorus] {key: A} {3/4}
| A | F#m | D / E | A |
{4/4} {rit 60 2}
| D | A |`;

  it('parses a chart with repeats, sections, a key change and 3/4 bars', () => {
    const p = parseChart(CHART);
    expect(p.errors).toEqual([]);
    expect(p.bars.length).toBe(10);
    const { song } = chartToSong(CHART, { title: 'Test', bpm: 100 });
    expect(song.bars[0].repeatStart).toBe(true);
    expect(song.bars[3].repeatEnd).toBe(2);
    expect(song.bars.map((b) => b.timeSignature.numerator)).toEqual([4, 4, 4, 4, 3, 3, 3, 3, 4, 4]);
    expect(song.bars.map((b) => b.key.fifths)).toEqual([1, 1, 1, 1, 3, 3, 3, 3, 3, 3]);
    expect(song.sections).toEqual([{ bar: 0, name: 'Verse' }, { bar: 4, name: 'Chorus' }]);
    expect(song.chordSymbols.filter((c) => c.bar === 2).map((c) => [c.tick, c.name])).toEqual([[0, 'C'], [1920, 'D']]);
    expect(song.chordSymbols.filter((c) => c.bar === 3).map((c) => c.name)).toEqual(['C', 'D']);
    // "D / E" in 3/4: D two beats, E one.
    expect(song.chordSymbols.filter((c) => c.bar === 6).map((c) => [c.tick, c.name])).toEqual([[0, 'D'], [1920, 'E']]);
    // Ritardando 100 -> 60 over bars 9-10 (to the end).
    expect(tempoChanges(song).map((t) => [t.bar, t.bpm, t.rampTo?.bpm])).toEqual([[0, 100, undefined], [8, 100, 60]]);
    expect(song.chart?.text).toBe(CHART);
  });

  it('the band generates from a chart (3/4 bars full, key change kept)', () => {
    const { song } = chartToSong(CHART, { bpm: 100 });
    const band = defaultBand('rock', undefined, 7);
    band.players = band.players.map((p) => (p.role === 'lead' ? { ...p, on: false } : p));
    const s = generateBand(song, band);
    expect(s.tracks.map((t) => t.generated?.role)).toEqual(['drums', 'bass', 'rhythm']);
    barsFull(s);
    // Bass plays chord roots: bar 5 (A) and bar 6 (F#m) start on A / F#.
    const bass = trackEvents(s, s.tracks[1]);
    const starts = barStartTicks(s);
    expect(mod12(bass.find((e) => e.start === starts[4])!.pitch)).toBe(9);
    expect(mod12(bass.find((e) => e.start === starts[5])!.pitch)).toBe(6);
    // 3/4 bars hold 3 beats of drums.
    const drums = trackEvents(s, s.tracks[0]).filter((e) => e.start >= starts[4] && e.start < starts[5]);
    expect(Math.max(...drums.map((e) => e.start - starts[4]))).toBeLessThan(2880);
  });

  it('tempo map: sudden change, ramp, removal', () => {
    let s = newSong('guitar', 8);
    expect(songLengthMs(s)).toBeCloseTo(16000, 3); // 8 bars of 4/4 at 120
    s = setTempoAt(s, 4, 60);
    expect(msAtTick(tempoPoints(s), barStartTicks(s)[4])).toBeCloseTo(8000, 3);
    expect(songLengthMs(s)).toBeCloseTo(8000 + 16000, 3);
    // Accelerando 60 -> 120 over bars 5-6: one point per beat, monotonic.
    s = setTempoRamp(s, 4, 6, 120);
    const pts = s.tempos.filter((t) => t.bar >= 4 && t.bar < 6);
    expect(pts.length).toBe(8);
    expect(pts.map((p) => p.bpm)).toEqual([60, 67.5, 75, 82.5, 90, 97.5, 105, 112.5]);
    expect(s.tempos.find((t) => t.bar === 6)?.bpm).toBe(120);
    const rampMs = pts.reduce((a, p) => a + 60000 / p.bpm, 0);
    expect(songLengthMs(s)).toBeCloseTo(8000 + rampMs + 4000, 3);
    expect(tempoChanges(s)).toEqual([{ bar: 0, bpm: 120 }, { bar: 4, bpm: 60, rampTo: { bar: 6, bpm: 120 } }, { bar: 6, bpm: 120 }]);
    s = removeTempoChange(s, 4);
    expect(tempoChanges(s)).toEqual([{ bar: 0, bpm: 120 }, { bar: 6, bpm: 120 }]);
    expect(songLengthMs(s)).toBeCloseTo(16000, 3);
    // The alphaTab score gets a tempo automation per ramp point (playback follows them).
    s = setTempoRamp(s, 2, 4, 90);
    const score = toAlphaTabScore(s, new alphaTab.Settings());
    expect(score.masterBars[2].tempoAutomations.length).toBe(4);
    expect(score.masterBars[3].tempoAutomations.map((a) => a.value)).toEqual([105, 101.25, 97.5, 93.75]);
  });

  it('Rocksmith export follows 3/4 bars and a ritardando', () => {
    const { song } = chartToSong(['| A | D |', '{3/4} {rit 60 2}', '| E | E |', '{4/4}', '| A |'].join('\n'), { bpm: 120 });
    const s = generateBand(song, { ...defaultBand('rock', undefined, 2), players: defaultBand('rock').players.map((p) => ({ ...p, on: p.role === 'bass' })) });
    const bass = s.tracks.find((t) => t.generated?.role === 'bass')!;
    const { arrangement: a, report } = rocksmithArrangement(s, bass.id, { type: 'Bass' });
    // Beats per bar between measure markers (after the lead-in): 4, 4, 3, 3, 4 (+ tail).
    const marks = a.beats.map((b, i) => (b[1] >= 0 ? i : -1)).filter((i) => i >= 0);
    const perBar = marks.slice(1).map((m, i) => m - marks[i]);
    const leadBars = Math.round(report.leadInMs / 2000);
    expect(perBar.slice(leadBars, leadBars + 5)).toEqual([4, 4, 3, 3, 4]);
    // Beat lengths grow through the ritardando (bars 3-4), then 60 bpm = 1000 ms beats.
    const first = marks[leadBars + 2];
    const lens = a.beats.slice(first, first + 7).map((b, i, arr) => (arr[i + 1] ? arr[i + 1][0] - b[0] : 0)).slice(0, 6);
    for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThan(lens[i - 1]);
    const afterRit = marks[leadBars + 4];
    expect(a.beats[afterRit + 1][0] - a.beats[afterRit][0]).toBeCloseTo(1000, -1);
  });

  it('key and time signature changes at any bar', () => {
    let s = ode();
    const k0 = s.bars[0].key;
    s = setKeyAt(s, 4, -1, 'major');
    expect(s.bars.slice(4).every((b) => b.key.fifths === -1)).toBe(true);
    expect(s.bars[3].key).toEqual(k0);
    s = removeKeyChange(s, 4);
    expect(s.bars.every((b) => b.key.fifths === k0.fifths)).toBe(true);
    const n = s.bars.length;
    s = setTimeSignatureAt(s, 2, 3, 4, 1);
    expect(s.bars.map((b) => b.timeSignature.numerator)).toEqual(Array.from({ length: n }, (_, i) => (i === 2 ? 3 : 4)));
    barsFull(s);
  });
});

describe('6. harmony lines', () => {
  it('Ode to Joy: every harmony note is in key and a diatonic 3rd from the melody (or a chord tone)', () => {
    let s = ode();
    // Chords so the harmony can follow them on strong beats.
    const fx = JSON.parse(readFileSync16('ode-to-joy-chords.json')) as { bars: string[][] };
    s = { ...s, chordSymbols: fx.bars.flatMap((names, bar) => names.map((name, i) => ({ bar, tick: i * 1920, name, source: 'user' as const }))) };
    const mel = melodyLine(s, 0);
    for (const [interval, sizes] of [['third', [3, 4]], ['sixth', [8, 9]]] as const) {
      for (const dir of ['above', 'below'] as const) {
        const h = harmonize(s, mel, interval, dir);
        expect(h.length).toBe(mel.length);
        let plain = 0;
        for (const n of h) {
          const k = keyOfBar(s, 0);
          expect(scalePcs(k).includes(mod12(n.pitch)), `in key ${n.pitch}`).toBe(true);
          const d = (n.pitch - n.melody) * (dir === 'above' ? 1 : -1);
          if (n.adjusted) {
            expect(d).toBeGreaterThanOrEqual(interval === 'third' ? 3 : 8);
          } else {
            expect(sizes as readonly number[]).toContain(d);
            plain++;
          }
        }
        expect(plain / h.length).toBeGreaterThan(0.7);
      }
    }
    const oct = harmonize(s, mel, 'octave', 'below');
    expect(oct.every((n) => n.melody - n.pitch === 12)).toBe(true);
  });

  it('adds a harmony track with the same rhythm', () => {
    const s = ode();
    const s2 = addHarmonyTrack(s, s.tracks[0].id, 'third', 'above');
    expect(s2.tracks.length).toBe(s.tracks.length + 1);
    const mel = melodyLine(s, 0);
    const h = trackEvents(s2, s2.tracks[1]);
    expect(h.map((e) => [e.start, e.dur])).toEqual(mel.map((e) => [e.start, e.dur]));
    barsFull(s2);
  });
});

describe('7. MIDI keyboard', () => {
  const on = (time: number, p: number, v = 100) => ({ time, data: [0x90, p, v] });
  const off = (time: number, p: number) => ({ time, data: [0x80, p, 0] });

  it('simulated input records the expected notes at the expected times', () => {
    // 120 bpm: a quarter = 500 ms. Recording starts at bar 2 (tick 3840) at t = 1000 ms.
    const r = new MidiRecorder(fixedTempoClock(120, 3840, 1000));
    const msgs = [
      on(1003, 60), off(1240, 60), // 8th on beat 1 (3 ms late)
      on(1490, 64), { time: 1735, data: [0x90, 64, 0] }, // note-on velocity 0 = off; 8th on beat 2 (10 ms early)
      on(2000, 67), on(2004, 72), off(2990, 67), off(2995, 72), // a two-note chord, a half note on beat 3
      on(3020, 62), // held to the end
    ];
    msgs.forEach((m) => r.message(m));
    const raw = r.finish(3500);
    const q = quantizeNotes(raw, '8');
    expect(q.map((n) => [n.start, n.dur, n.pitch])).toEqual([
      [3840, 480, 60], [4800, 480, 64], [5760, 1920, 67], [5760, 1920, 72], [7680, 960, 62],
    ]);
    expect(q[0].velocity).toBe(100);
    // 16th-triplet quantise keeps the tiny lateness away; 'none' keeps a 64th grid.
    expect(quantizeNotes(raw, '16T')[0].start).toBe(3840);
    expect(quantizeNotes(raw, 'none')[0].start).toBe(3840);
    // Into a track: replace mode clears the range first.
    let s = newSong('guitar', 4);
    s = addRollNote(s, 0, 0, { start: 3840, dur: 960, pitch: 40 });
    s = mergeTake(s, 0, q, 3840, 7680 + 960, 'replace');
    expect(staffNotes(s, 0, 0).map((e) => [e.start, e.pitch])).toEqual([[3840, 60], [4800, 64], [5760, 67], [5760, 72], [7680, 62]]);
    barsFull(s);
  });

  it('notes before the recording start (count-in) are dropped', () => {
    const r = new MidiRecorder(fixedTempoClock(120, 0, 2000));
    r.message(on(1500, 60));
    r.message(off(1700, 60));
    r.message(on(2000, 62));
    expect(quantizeNotes(r.finish(2500), '16', 0).map((n) => n.pitch)).toEqual([62]);
  });

  it('step entry puts a chord on the cursor beat', () => {
    const s = newSong('guitar', 1);
    const s2 = setBeatPitches(s, { track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }, [64, 60, 55]);
    const b = s2.tracks[0].staves[0].measures[0].voices[0].beats[0];
    expect(b.notes.map((n) => n.pitch)).toEqual([55, 60, 64]);
    for (const n of b.notes) expect(s2.tracks[0].tuning![n.string! - 1] + n.fret!).toBe(n.pitch);
  });
});

describe('8. save/load and undo', () => {
  it('everything survives save -> reopen (deep-equal)', () => {
    let { song: s } = chartToSong('{key: Em}\n[Intro]\n|: Em | C G | D | B7 :|\n{3/4}\n| Am | {accel 140 2} B7 | Em |', { bpm: 90 });
    s = generateBand(s, { ...defaultBand('blues', undefined, 5), players: defaultBand('blues').players.map((p) => ({ ...p, on: p.role !== 'lead' })) });
    const di = s.tracks.findIndex((t) => t.generated?.role === 'drums');
    s = setDrumStep(s, di, 1, 32, false, 49, 0, 124);
    s = addRollNote(s, 1, 0, { start: 320, dur: 320, pitch: 50 });
    s = setKeyAt(s, 2, 2, 'major');
    s = setTempoRamp(s, 1, 3, 70);
    s = insertChordBars(s, 0, 1, [['Em7'], ['Cmaj7', 'D']]);
    s = addHarmonyTrack(s, s.tracks[2].id, 'sixth', 'below');
    const back = parseProject(serializeProject(s));
    expect(back).toEqual(s);
    expect(JSON.parse(serializeProject(s)).schemaVersion).toBe(4);
  });

  it('each action is one undo step', () => {
    const s0 = newSong('guitar', 4);
    const h = new History(s0);
    const steps: [string, (s: Song) => Song][] = [
      ['draw', (s) => addRollNote(s, 0, 0, { start: 0, dur: 960, pitch: 64 })],
      ['move', (s) => moveRollNotes(s, 0, 0, [0], 480, 1)],
      ['chords', (s) => insertChordBars(s, 0, 3, [['C'], ['G']])],
      ['key', (s) => setKeyAt(s, 2, 1, 'major')],
      ['3/4', (s) => setTimeSignatureAt(s, 3, 3, 4)],
      ['ramp', (s) => setTempoRamp(s, 1, 3, 90)],
      ['harmony', (s) => addHarmonyTrack(s, 't1', 'third', 'above')],
    ];
    const states = [s0];
    for (const [label, fn] of steps) states.push(h.apply(fn(h.present), label));
    for (let i = steps.length; i > 0; i--) {
      expect(h.present).toEqual(states[i]);
      h.undo();
    }
    expect(h.present).toEqual(s0);
  });
});

function readFileSync16(name: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync(require('node:path').join(__dirname, '..', 'fixtures', name), 'utf8');
}
