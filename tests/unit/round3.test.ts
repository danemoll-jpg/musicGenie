// Round 3: note editing, techniques, tunings/capo, Rocksmith conversion and round trip.
import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { fromAlphaTabScore } from '../../src/import/fromAlphaTab';
import {
  barsFromBeats, barTicks, BEND_SHAPES, copyBars, copyBeat, countNoteOnsets, defaultBand, deleteBars, deleteBeat, deleteNote,
  durationTicks, enterLetter, generateBand, hashOf, hasTechnique, insertBars, insertBeat, makeRest, moveCursor,
  msAtTick, newSong, parseProject, paste, rocksmithArrangement, rocksmithProblem, rsNoteCount, serializeProject,
  setCapo, setDuration, setFret, setInstrument, setSection, setTuning, shiftPitch, songFromRocksmith,
  songLengthMs, stepDuration, tempoPoints, tickAtMs, toggleDot, toggleTechnique, toggleTie, toggleTriplet,
  trackEvents, GUITAR_TUNINGS, type Cursor, type RsArrangement, type Song, type TechniqueId, type Track,
} from '../../src/model';
import { toAlphaTabScore } from '../../src/render/toAlphaTab';
import { readTestFile } from './helpers';

const ode = (): Song => importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
const cur = (p: Partial<Cursor> = {}): Cursor => ({ track: 0, staff: 0, bar: 0, voice: 0, beat: 0, string: 1, ...p });
const beats = (s: Song, bar = 0, track = 0) => s.tracks[track].staves[0].measures[bar].voices[0].beats;

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

describe('note editing (tab)', () => {
  const bass = () => newSong('bass');

  it('a new bass song has 4 strings and empty, full bars', () => {
    const s = bass();
    expect(s.tracks[0].tuning).toEqual([28, 33, 38, 43]);
    expect(s.tracks[0].display.mode).toBe('tab');
    barsFull(s);
  });

  it('types frets on strings; pitch follows the tuning', () => {
    let s = setFret(bass(), cur({ string: 1 }), 3); // G on the E string
    s = setFret(s, cur({ string: 2 }), 5); // D on the A string -> a two-note beat
    const b = beats(s)[0];
    expect(b.notes.map((n) => [n.string, n.fret, n.pitch])).toEqual([[1, 3, 31], [2, 5, 38]]);
    s = setFret(s, cur({ string: 1 }), 12); // replace
    expect(beats(s)[0].notes[0]).toMatchObject({ string: 1, fret: 12, pitch: 40 });
    barsFull(s);
  });

  it('durations, dots, triplets, ties, rests keep every bar full', () => {
    let s = setDuration(bass(), cur(), { base: 8, dots: 0 });
    expect(beats(s).map((b) => b.duration.base)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
    s = setFret(s, cur(), 3);
    s = toggleDot(s, cur());
    expect(beats(s)[0].duration.dots).toBe(1);
    barsFull(s);
    s = toggleDot(s, cur());
    s = stepDuration(s, cur(), 1); // 8th -> 16th
    expect(beats(s)[0].duration.base).toBe(16);
    s = stepDuration(s, cur(), -1);
    s = toggleTriplet(s, cur({ beat: 1 }));
    expect(beats(s).filter((b) => b.duration.tuplet).length).toBe(3);
    barsFull(s);
    s = toggleTriplet(s, cur({ beat: 1 }));
    expect(beats(s).some((b) => b.duration.tuplet)).toBe(false);
    s = setFret(s, cur({ beat: 1 }), 3);
    s = toggleTie(s, cur({ beat: 1 }));
    expect(beats(s)[1].notes[0].tieFromPrevious).toBe(true);
    s = makeRest(s, cur({ beat: 1 }));
    expect(beats(s)[1].notes).toEqual([]);
    barsFull(s);
  });

  it('insert/delete beat, delete note, copy/paste beats and bars, insert/delete bars', () => {
    let s = setDuration(bass(), cur(), { base: 4, dots: 0 });
    s = setFret(s, cur({ beat: 0 }), 1);
    s = setFret(s, cur({ beat: 1 }), 2);
    s = insertBeat(s, cur({ beat: 1 }));
    expect(beats(s).map((b) => b.notes[0]?.fret ?? null)).toEqual([1, null, 2, null]);
    s = deleteBeat(s, cur({ beat: 1 }));
    expect(beats(s).map((b) => b.notes[0]?.fret ?? null)).toEqual([1, 2, null, null]);
    s = deleteNote(s, cur({ beat: 1 }));
    expect(beats(s)[1].notes).toEqual([]);
    barsFull(s);
    // copy beat 0 -> paste on bar 2 beat 0
    const clip = copyBeat(s, cur())!;
    s = paste(s, cur({ bar: 1 }), clip);
    expect(beats(s, 1)[0].notes[0].fret).toBe(1);
    // copy bars 1-2 -> paste at bar 7 (adds a bar at the end: song had 8)
    const bars = copyBars(s, cur(), 0, 1);
    s = paste(s, cur({ bar: 7 }), bars);
    expect(s.bars.length).toBe(9);
    expect(beats(s, 7)[0].notes[0].fret).toBe(1);
    expect(beats(s, 8)[0].notes[0].fret).toBe(1);
    barsFull(s);
    s = insertBars(s, 0, 2);
    expect(s.bars.length).toBe(11);
    expect(beats(s, 2)[0].notes[0].fret).toBe(1);
    s = deleteBars(s, 0, 1);
    expect(s.bars.length).toBe(9);
    expect(beats(s, 0)[0].notes[0].fret).toBe(1);
    expect(() => deleteBars(s, 0, 8)).toThrow(/at least one bar/);
    barsFull(s);
  });

  it('cursor moves across beats, bars and strings', () => {
    const s = setDuration(bass(), cur(), { base: 2, dots: 0 });
    let c = moveCursor(s, cur(), 'right');
    expect(c.beat).toBe(1);
    c = moveCursor(s, c, 'right');
    expect([c.bar, c.beat]).toEqual([1, 0]);
    c = moveCursor(s, c, 'left');
    expect([c.bar, c.beat]).toEqual([0, 1]);
    c = moveCursor(s, { ...c, string: 4 }, 'up');
    expect(c.string).toBe(4);
    c = moveCursor(s, c, 'down');
    expect(c.string).toBe(3);
  });

  it('every edit is one undoable step and marks a generated track as edited', () => {
    const song = setSection(setSection(ode(), 0, 7, 'Verse'), 8, 15, 'Chorus');
    const band = generateBand(song, defaultBand('rock', song.tracks[0].id, 7));
    const ti = band.tracks.findIndex((t) => t.generated?.role === 'bass');
    const t = band.tracks[ti];
    expect(hashOf(t.staves)).toBe(t.generated!.contentHash);
    const edited = setFret(band, cur({ track: ti, string: 2 }), 7);
    const t2 = edited.tracks[ti];
    expect(hashOf(t2.staves)).not.toBe(t2.generated!.contentHash);
    expect(band.tracks[ti].staves).toStrictEqual(t.staves); // input untouched
  });
});

describe('note editing (staff)', () => {
  it('letters enter the nearest pitch in the key; arrows change pitch', () => {
    let s = ode(); // piano, C major
    const c = cur({ bar: 0, beat: 0 });
    const before = beats(s)[0].notes[0].pitch;
    s = enterLetter(s, c, 'G');
    const p = beats(s)[0].notes[0].pitch;
    expect(p % 12).toBe(7);
    s = shiftPitch(s, c, 1);
    expect(beats(s)[0].notes[0].pitch).toBe(p + 1);
    s = enterLetter(s, c, 'C', true); // add to chord
    expect(beats(s)[0].notes.length).toBe(2);
    expect(before).toBeGreaterThan(0);
    // G major: F means F#
    s.bars[0].key.fifths = 1;
    s = enterLetter(s, c, 'F');
    expect(beats(s)[0].notes[0].pitch % 12).toBe(6);
  });

  it('on a guitar track, entered notes get playable strings and frets', () => {
    let s = setInstrument(ode(), 't1', 'electric-guitar-clean');
    s = enterLetter(s, cur(), 'A');
    const n = beats(s)[0].notes[0];
    expect(n.string).toBeDefined();
    expect(s.tracks[0].tuning![n.string! - 1] + n.fret!).toBe(n.pitch);
  });
});

const ALL_TECHNIQUES: TechniqueId[] = [
  'hammerOn', 'pullOff', 'slide', 'slideLegato', 'slideOutUp', 'slideOutDown', 'bendHalf', 'bendFull', 'bendFullHalf',
  'bendRelease', 'vibrato', 'palmMute', 'dead', 'harmonic', 'pinchHarmonic', 'tap', 'slap', 'pop', 'accent', 'tremolo',
];

describe('techniques', () => {
  /** One beat per technique (16ths across bars), each with a note on string 3. */
  function riffWithAll(): Song {
    let s = newSong('guitar', 8);
    let c = cur({ string: 3 });
    for (let bar = 0; bar < 2; bar++) s = setDuration(s, cur({ bar }), { base: 16, dots: 0 });
    // A hammer-on/pull-off needs a note before it on the string: start with something else.
    const order = [...ALL_TECHNIQUES.slice(2), ...ALL_TECHNIQUES.slice(0, 2)];
    order.forEach((id, i) => {
      c = cur({ bar: Math.floor(i / 16), beat: i % 16, string: 3 });
      s = setFret(s, c, id === 'hammerOn' ? 9 : id === 'pullOff' ? 5 : 6 + (i % 2)); // HO goes up, PO goes down
      s = toggleTechnique(s, c, id);
    });
    return s;
  }

  it('each technique toggles on and off', () => {
    let s = setFret(newSong('guitar'), cur({ string: 2 }), 5);
    for (const id of ALL_TECHNIQUES) {
      s = toggleTechnique(s, cur({ string: 2 }), id);
      expect(hasTechnique(beats(s)[0].notes[0], id), id).toBe(true);
      s = toggleTechnique(s, cur({ string: 2 }), id);
      expect(hasTechnique(beats(s)[0].notes[0], id), id).toBe(false);
    }
  });

  it('hammer-on/pull-off picks the direction from the previous note', () => {
    let s = setDuration(newSong('guitar'), cur(), { base: 4, dots: 0 });
    s = setFret(s, cur({ string: 3 }), 7);
    s = setFret(s, cur({ string: 3, beat: 1 }), 5);
    s = toggleTechnique(s, cur({ string: 3, beat: 1 }), 'hopo');
    expect(beats(s)[1].notes[0].techniques).toEqual({ pullOff: true });
    s = setFret(s, cur({ string: 3, beat: 2 }), 9);
    s = toggleTechnique(s, cur({ string: 3, beat: 2 }), 'hopo');
    expect(beats(s)[2].notes[0].techniques).toEqual({ hammerOn: true });
  });

  it('save -> reopen keeps every technique', () => {
    const s = riffWithAll();
    const back = parseProject(serializeProject(s));
    expect(back).toStrictEqual(s);
    const found = ALL_TECHNIQUES.filter((id) => back.tracks[0].staves[0].measures.some((m) => m.voices[0].beats.some((b) => b.notes.some((n) => hasTechnique(n, id)))));
    expect(found).toEqual(ALL_TECHNIQUES);
  });

  it('alphaTab shows them: model -> alphaTab -> model keeps them', () => {
    const s = riffWithAll();
    const back = fromAlphaTabScore(toAlphaTabScore(s, new alphaTab.Settings()));
    const a = trackEvents(s, s.tracks[0]);
    const b = trackEvents(back, back.tracks[0]);
    expect(b.length).toBe(a.length);
    const keys = (e: (typeof a)[0]) => Object.keys(e.techniques ?? {}).filter((k) => k !== 'slideToFret').sort();
    a.forEach((e, i) => expect(keys(b[i]), `note ${i}`).toEqual(keys(e)));
    expect(b.some((e) => e.techniques?.tremolo)).toBe(true);
    // alphaTab may simplify the curve (fewer points); the bend amount stays.
    const maxBend = (e?: (typeof a)[0]) => Math.max(...(e?.techniques?.bend ?? []).map((p) => p.value));
    a.forEach((e, i) => { if (e.techniques?.bend) expect(maxBend(b[i])).toBe(maxBend(e)); });
    expect(maxBend(a.find((e) => e.techniques?.bend))).toBe(Math.max(...BEND_SHAPES.bendHalf.map((p) => p.value)));
  });
});

describe('tunings and capo', () => {
  const riff = () => {
    let s = setDuration(newSong('guitar'), cur(), { base: 4, dots: 0 });
    s = setFret(s, cur({ string: 1 }), 0); // E2
    s = setFret(s, cur({ string: 1, beat: 1 }), 3); // G2
    s = setFret(s, cur({ string: 2, beat: 2 }), 2); // B2
    return s;
  };
  const dropD = GUITAR_TUNINGS.find((t) => t.id === 'drop-d')!.pitches;

  it('Drop D keeping pitches re-places frets', () => {
    const s = setTuning(riff(), 't1', dropD, 'keepPitch');
    expect(s.tracks[0].tuning).toEqual([38, 45, 50, 55, 59, 64]);
    const b = beats(s);
    expect(b[0].notes[0]).toMatchObject({ pitch: 40, string: 1, fret: 2 });
    expect(b[1].notes[0]).toMatchObject({ pitch: 43, string: 1, fret: 5 });
    expect(b[2].notes[0]).toMatchObject({ pitch: 47, string: 2, fret: 2 });
  });

  it('Drop D keeping frets changes pitches on the low string only', () => {
    const s = setTuning(riff(), 't1', dropD, 'keepFrets');
    const b = beats(s);
    expect(b[0].notes[0]).toMatchObject({ pitch: 38, fret: 0 });
    expect(b[1].notes[0]).toMatchObject({ pitch: 41, fret: 3 });
    expect(b[2].notes[0]).toMatchObject({ pitch: 47, fret: 2 });
  });

  it('a note that no longer fits moves to another string', () => {
    let s = setFret(newSong('guitar'), cur({ string: 1 }), 0); // E2 = lowest possible
    s = setTuning(s, 't1', [41, 46, 51, 56, 60, 65], 'keepPitch'); // F standard: E2 is now too low
    expect(beats(s)[0].notes[0].string).toBeUndefined();
  });

  it('capo keeps pitches; frets count from the nut', () => {
    let s = setCapo(riff(), 't1', 2);
    expect(s.tracks[0].capo).toBe(2);
    const b = beats(s);
    expect(b[1].notes[0]).toMatchObject({ pitch: 43, fret: 3 });
    expect(b[0].notes[0]).toMatchObject({ pitch: 40, fret: 0 }); // E2 is below a capo on 2: nowhere else to go, left as it was
    // "0" typed with a capo = the capo fret
    s = setFret(s, cur({ string: 3, beat: 3 }), 0);
    expect(beats(s)[3].notes.find((n) => n.string === 3)).toMatchObject({ fret: 2, pitch: 52 });
    // alphaTab gets frets relative to the capo, and gives them back from the nut
    const back = fromAlphaTabScore(toAlphaTabScore(s, new alphaTab.Settings()));
    expect(beats(back)[3].notes.find((n) => n.string === 3)).toMatchObject({ fret: 2, pitch: 52 });
  });
});

describe('tempo map timing', () => {
  it('ms <-> ticks are inverse and follow tempo changes', () => {
    const s = newSong('guitar');
    s.tempos = [{ bar: 0, tick: 0, bpm: 120 }, { bar: 2, tick: 0, bpm: 60 }];
    const pts = tempoPoints(s);
    expect(msAtTick(pts, 960)).toBe(500);
    expect(msAtTick(pts, 2 * 3840)).toBe(4000);
    expect(msAtTick(pts, 2 * 3840 + 960)).toBe(5000);
    for (const t of [0, 123, 4000, 9000]) expect(tickAtMs(pts, msAtTick(pts, t))).toBeCloseTo(t, 6);
    expect(songLengthMs(s)).toBe(4000 + 6 * 4000);
  });
});

// ---------------- Rocksmith ----------------

function rockBand(): Song {
  const song = setSection(setSection(ode(), 0, 7, 'Verse'), 8, 15, 'Chorus');
  return generateBand(song, defaultBand('rock', song.tracks[0].id, 42));
}
const byRole = (s: Song, r: string) => s.tracks.find((t) => t.generated?.role === r)!;

/** Notes of a track in time order: [pitch, string, fret, sorted technique names]. */
function noteList(song: Song, t: Track) {
  return trackEvents(song, t).map((e) => [e.pitch, e.string, e.fret, Object.keys(e.techniques ?? {}).sort().join(',')]);
}

describe('Rocksmith export', () => {
  it('refuses tracks Rocksmith cannot play', () => {
    const s = ode();
    expect(rocksmithProblem(s.tracks[0], 'Lead')).toMatch(/not a guitar or bass/);
    const five = setInstrument(s, 't1', 'fingered-bass');
    five.tracks[0].tuning = [23, 28, 33, 38, 43];
    expect(rocksmithProblem(five.tracks[0], 'Bass')).toMatch(/4-string/);
    expect(() => rocksmithArrangement(s, 't1', { type: 'Lead' })).toThrow(/Rocksmith 2014 only has/);
  });

  it('exports the Rock bass and guitar from Ode to Joy with beats, phrases, sections, anchors', () => {
    const s = rockBand();
    for (const [role, type] of [['bass', 'Bass'], ['rhythm', 'Rhythm']] as const) {
      const t = byRole(s, role);
      const { arrangement: a, report } = rocksmithArrangement(s, t.id, { type });
      expect(rsNoteCount(a)).toBe(countNoteOnsets(s, s.tracks.indexOf(t)));
      expect(a.phrases[0].name).toBe('COUNT');
      expect(a.phrases[a.phrases.length - 1].name).toBe('END');
      expect(a.sections.map((x) => x.name)).toEqual(['verse', 'chorus', 'noguitar']);
      // Nothing in the COUNT phrase; first section starts after the lead-in.
      const firstSection = a.sections[0].t;
      expect(firstSection).toBe(report.leadInMs);
      expect(Math.min(...a.notes.map((n) => n.t), ...a.chords.map((c) => c.t))).toBeGreaterThanOrEqual(firstSection);
      // Beats are strictly increasing; bars start with a measure number.
      for (let i = 1; i < a.beats.length; i++) expect(a.beats[i][0]).toBeGreaterThan(a.beats[i - 1][0]);
      expect(a.beats.filter((b) => b[1] >= 0).length).toBeGreaterThanOrEqual(s.bars.length + 2);
      // Every fretted note sits inside an anchor.
      const anchorAt = (tm: number) => [...a.anchors].reverse().find((x) => x[0] <= tm)!;
      for (const n of a.notes) {
        if (n.f === 0) continue;
        const [, fret, width] = anchorAt(n.t);
        expect(n.f, `note at ${n.t}`).toBeGreaterThanOrEqual(fret);
        expect(n.f).toBeLessThanOrEqual(fret + width - 1);
      }
      expect(a.tuning).toEqual([0, 0, 0, 0, 0, 0]);
      if (type === 'Rhythm') {
        expect(a.chords.length).toBeGreaterThan(0);
        expect(a.handShapes.length).toBe(a.chords.length);
        expect(a.chordTemplates.every((c) => c.frets.length === 6)).toBe(true);
      }
    }
  });

  it('round trip: export -> import keeps notes, techniques, sections and tuning', () => {
    let s = rockBand();
    const bassT = byRole(s, 'bass');
    const bi = s.tracks.indexOf(bassT);
    // Give the bass some techniques and Drop D.
    s = setTuning(s, bassT.id, [26, 33, 38, 43], 'keepPitch');
    const marks: [number, number, TechniqueId][] = [[0, 0, 'palmMute'], [1, 0, 'slideOutDown'], [2, 0, 'vibrato'], [3, 0, 'accent'], [4, 0, 'dead'], [5, 0, 'bendFull'], [6, 0, 'harmonic'], [7, 0, 'tremolo'], [8, 0, 'slap'], [9, 0, 'pop'], [10, 0, 'tap']];
    for (const [bar, beat, id] of marks) {
      const n = beats(s, bar, bi)[beat].notes[0];
      s = toggleTechnique(s, cur({ track: bi, bar, beat, string: n.string }), id);
    }
    const { arrangement } = rocksmithArrangement(s, bassT.id, { type: 'Bass' });
    const { song: back } = songFromRocksmith({ title: s.title, artist: 'X', album: '', year: 2026, arrangements: [arrangement] });
    const t = back.tracks[0];
    expect(t.tuning).toEqual([26, 33, 38, 43]);
    expect(t.rocksmith?.arrangement).toBe('Bass');
    expect(noteList(back, t)).toEqual(noteList(s, s.tracks[bi]));
    // Lead-in bars come back as empty bars before bar 1, then the same sections.
    const lead = back.bars.length - s.bars.length - 1; // -1: the tail bar
    expect(lead).toBeGreaterThanOrEqual(1);
    expect(back.sections.filter((x) => x.name !== 'No guitar').map((x) => [x.bar - lead, x.name])).toEqual([[0, 'Verse'], [8, 'Chorus']]);
    // Same tempo: bar 1 of the song is at the same time after the lead-in.
    expect(back.tempos[0].bpm).toBeCloseTo(s.tempos[0].bpm, 2);
  });

  it('round trip on a chord track keeps chord notes and chord names', () => {
    const s = rockBand();
    const t = byRole(s, 'rhythm');
    const { arrangement } = rocksmithArrangement(s, t.id, { type: 'Rhythm' });
    const { song: back } = songFromRocksmith({ title: '', artist: '', album: '', year: 0, arrangements: [arrangement] });
    expect(noteList(back, back.tracks[0])).toEqual(noteList(s, t));
    expect(back.chordSymbols.length).toBeGreaterThan(0);
  });
});

describe('Rocksmith import (synthetic chart)', () => {
  // 120 bpm, 4/4, two bars + closing beat; a few notes with techniques and one chord.
  const beatsArr: [number, number][] = [[1000, 1], [1500, -1], [2000, -1], [2500, -1], [3000, 2], [3500, -1], [4000, -1], [4500, -1], [5000, 3]];
  const note = (t: number, s: number, f: number, extra: Partial<RsArrangement['notes'][0]> = {}) =>
    ({ t, s, f, sus: 0, mask: 0, slideTo: -1, slideUnpitchTo: -1, tap: 0, vib: 0, bends: [], ...extra });
  const arr: RsArrangement = {
    name: 'Lead', tuning: [-2, 0, 0, 0, 0, 0], capo: 0, beats: beatsArr,
    phrases: [{ name: 'COUNT', maxDifficulty: 0 }, { name: 'riff', maxDifficulty: 0 }, { name: 'END', maxDifficulty: 0 }],
    phraseIterations: [[1000, 0], [1000, 1], [5000, 2]],
    sections: [{ name: 'riff', t: 1000, n: 1 }, { name: 'solo', t: 3000, n: 1 }],
    chordTemplates: [{ name: 'D5', displayName: 'D5', frets: [0, 0, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1] }],
    notes: [
      note(1000, 0, 0, { mask: 64 }), // palm mute, D (drop D low string)
      note(1250, 2, 5, { sus: 500, slideTo: 7, mask: 1 }), // legato slide to the next note
      note(1750, 2, 7, { mask: 4 }), // hammer-on
      note(2000, 3, 7, { sus: 500, bends: [[2100, 1]] }), // full bend
      note(2500, 3, 9, { sus: 500, vib: 80 }),
      note(3500, 4, 0, { mask: 8 }), // harmonic
    ],
    chords: [{ t: 3000, id: 0, mask: 32, notes: [] }],
    anchors: [[1000, 5, 4]], handShapes: [[0, 3000, 3400]],
  };

  it('a stray beat marker a few ms before the next one is dropped', () => {
    const { bars, tempos, firstBeatMs } = barsFromBeats([[0, 1], [7, -1], [500, -1], [1000, -1], [1500, 2], [2000, -1], [2500, -1], [3000, -1], [3500, 3]]);
    expect(firstBeatMs).toBe(7);
    expect(bars.map((b) => b.timeSignature.numerator)).toEqual([3, 4]);
    expect(Math.max(...tempos.map((t) => t.bpm))).toBeLessThan(130);
  });

  it('beats become bars and a tempo map; notes keep string, fret and techniques', () => {
    const { song, report } = songFromRocksmith({ title: 'T', artist: 'A', album: 'B', year: 2020, audioOgg: 'x.ogg', arrangements: [arr] });
    expect(song.bars.length).toBe(2);
    expect(song.bars[0].timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(song.tempos[0].bpm).toBe(120);
    expect(song.backing).toMatchObject({ path: 'x.ogg', offsetMs: 1000 });
    expect(song.sections).toEqual([{ bar: 0, name: 'Riff' }, { bar: 1, name: 'Solo' }]);
    const t = song.tracks[0];
    expect(t.tuning).toEqual([38, 45, 50, 55, 59, 64]);
    expect(report.arrangements[0].notes).toBe(8);
    const ev = trackEvents(song, t);
    expect(ev.map((e) => [e.start, e.string, e.fret])).toEqual([
      [0, 1, 0], [480, 3, 5], [1440, 3, 7], [1920, 4, 7], [2880, 4, 9], [3840, 1, 0], [3840, 2, 0], [4800, 5, 0],
    ]);
    expect(ev[0].techniques).toEqual({ palmMute: true });
    expect(ev[1].techniques).toEqual({ slideOut: 'legato' });
    expect(ev[2].techniques).toEqual({ hammerOn: true });
    expect(ev[3].techniques?.bend).toEqual([{ position: 0, value: 0 }, { position: 12, value: 4 }, { position: 60, value: 4 }]);
    expect(ev[4].techniques).toEqual({ vibrato: 'slight' });
    expect(ev[5].techniques).toEqual({ palmMute: true });
    expect(ev[7].techniques).toEqual({ harmonic: 'natural' });
    expect(song.chordSymbols).toEqual([{ bar: 1, tick: 0, name: 'D5', source: 'file' }]);
  });
});
