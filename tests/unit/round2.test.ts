// Round 2: chord recognition, split, sections, band styles, save/load + undo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import {
  applyDetectedChords, chordAt, chordTones, countNoteOnsets, defaultBand, detectChords, editedGeneratedTracks,
  findInstrument, generateBand, GM, hashOf, History, instrumentRange, noteAddresses, parseChord, parseProject,
  regenerate, sameChord, sectionRanges, serializeProject, setChordSymbol, setSection, splitTrack, STYLE_IDS,
  barStartTicks, durationTicks, type Song, type StyleId, type Track, classifyParts,
} from '../../src/model';
import { readTestFile } from './helpers';

const ode = (): Song => importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
const bach = (): Song => importFile('bach-prelude-c-bwv846.mid', readTestFile('bach-prelude-c-bwv846.mid'));
const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8')).bars as string[][] | string[];

/** Every beat of a track with its absolute tick. */
function beatsOf(song: Song, t: Track) {
  const starts = barStartTicks(song);
  const out: { bar: number; tick: number; notes: Track['staves'][0]['measures'][0]['voices'][0]['beats'][0]['notes'] }[] = [];
  for (const st of t.staves)
    st.measures.forEach((m, bi) =>
      m.voices.forEach((v) => {
        let tick = 0;
        for (const b of v.beats) {
          out.push({ bar: bi, tick: starts[bi] + tick, notes: b.notes });
          if (!b.grace) tick += durationTicks(b.duration);
        }
      }),
    );
  return out;
}

function barLengthsOk(song: Song, t: Track) {
  const starts = barStartTicks(song);
  for (const st of t.staves)
    st.measures.forEach((m, bi) => {
      const len = (bi + 1 < starts.length ? starts[bi + 1] : starts[bi] + 3840) - starts[bi];
      for (const v of m.voices) {
        const sum = v.beats.filter((b) => !b.grace).reduce((a, b) => a + durationTicks(b.duration), 0);
        if (v.beats.length) expect(sum).toBe(len);
      }
    });
}

describe('chord recognition', () => {
  it('parses and compares chord names', () => {
    expect(parseChord('Am7/G')).toEqual({ root: 9, quality: 'm7', bass: 7 });
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, quality: 'maj7' });
    expect(parseChord('E5')).toMatchObject({ quality: '5' });
    expect(chordTones(parseChord('G7')!)).toEqual([7, 11, 2, 5]);
    expect(sameChord('G7/B', 'G')).toBe(true);
    expect(sameChord('C#dim7', 'Edim7/G')).toBe(true);
    expect(sameChord('Am', 'A')).toBe(false);
  });

  it('Bach Prelude in C: >= 90% of bars match the hand labels', () => {
    const song = bach();
    const want = fixture('bach-prelude-chords.json') as string[];
    const got = detectChords(song);
    let ok = 0;
    const misses: string[] = [];
    want.forEach((w, bar) => {
      const c = chordAt(got, bar, 0)?.name ?? '';
      if (w.split('|').some((x) => sameChord(x, c))) ok++;
      else misses.push(`bar ${bar + 1}: want ${w} got ${c}`);
    });
    const pct = (100 * ok) / want.length;
    console.log(`Bach: ${ok}/${want.length} = ${pct.toFixed(1)}%`, misses.join('; '));
    expect(pct).toBeGreaterThanOrEqual(90);
  });

  it('Ode to Joy: >= 90% of bars match the hand labels (incl. half-bar changes)', () => {
    const song = ode();
    const want = fixture('ode-to-joy-chords.json') as string[][];
    const got = detectChords(song);
    let ok = 0;
    const misses: string[] = [];
    want.forEach((w, bar) => {
      const a = chordAt(got, bar, 0)?.name ?? '';
      const b = chordAt(got, bar, 1920)?.name ?? '';
      const wa = w[0];
      const wb = w[1] ?? w[0];
      if (sameChord(wa, a) && sameChord(wb, b)) ok++;
      else misses.push(`bar ${bar + 1}: want ${w.join(' ')} got ${a} ${b}`);
    });
    const pct = (100 * ok) / want.length;
    console.log(`Ode: ${ok}/${want.length} = ${pct.toFixed(1)}%`, misses.join('; '));
    expect(pct).toBeGreaterThanOrEqual(90);
  });

  it('keeps chords that came with the file unless asked', () => {
    const song = ode();
    const fileChords = song.chordSymbols.map((c) => c.name);
    const det = detectChords(song);
    expect(applyDetectedChords(song, det).chordSymbols.map((c) => c.name)).toEqual(fileChords);
    const replaced = applyDetectedChords(song, det, true);
    expect(replaced.chordSymbols.every((c) => c.source === 'detected')).toBe(true);
    const edited = setChordSymbol(replaced, 0, 0, 'Am');
    expect(chordAt(edited.chordSymbols, 0, 0)).toMatchObject({ name: 'Am', source: 'user' });
  });
});

describe('split into band parts', () => {
  it('Ode to Joy piano -> melody / harmony / bass; every note in exactly one part', () => {
    const song = ode();
    const src = song.tracks[0];
    const split = splitTrack(song, src.id);
    const parts = split.tracks.filter((t) => t.derived?.from === src.id);
    expect(parts.map((t) => t.derived!.part)).toEqual(['melody', 'harmony', 'bass']);
    expect(split.tracks[0].mixer.mute).toBe(true); // source kept, muted
    expect(split.tracks[0].staves).toStrictEqual(src.staves);
    // Each source note address is assigned to exactly one part ...
    const cls = classifyParts(song, src);
    const all = noteAddresses(src);
    expect(cls.size).toBe(all.length);
    // ... and the parts together hold exactly the source notes, at the same times.
    const key = (bar: number, tick: number, p: number) => `${bar}:${tick}:${p}`;
    const srcNotes = beatsOf(song, src).flatMap((b) => b.notes.map((n) => key(b.bar, b.tick, n.pitch) + (n.tieFromPrevious ? 't' : ''))).sort();
    const partNotes = parts.flatMap((t) => beatsOf(split, t).flatMap((b) => b.notes.map((n) => key(b.bar, b.tick, n.pitch) + (n.tieFromPrevious ? 't' : '')))).sort();
    expect(partNotes).toEqual(srcNotes);
    expect(countNoteOnsets(split) - countNoteOnsets(song)).toBe(countNoteOnsets(song)); // parts = one more copy
    // Melody = the right-hand tune: first bar E E F G.
    const mel = parts[0];
    expect(mel.staves.length).toBe(1);
    expect(mel.staves[0].measures[0].voices[0].beats.map((b) => b.notes[0]?.pitch)).toEqual([64, 64, 65, 67]);
    expect(parts[2].staves[0].measures[0].voices[0].beats[0].notes[0].pitch).toBe(48); // bass C3
    for (const t of parts) barLengthsOk(split, t);
  });
  it('works on every pitched track of the Guitar Pro song', () => {
    const song = importFile('full-song.gp', readTestFile('full-song.gp'));
    for (const t of song.tracks.filter((x) => !x.instrument.percussion)) {
      const cls = classifyParts(song, t);
      expect(cls.size).toBe(noteAddresses(t).length);
    }
  });
});

describe('sections', () => {
  it('names bar ranges and keeps what follows', () => {
    const song = ode();
    expect(sectionRanges({ ...song, sections: [] })).toEqual([{ name: 'Song', startBar: 0, endBar: 16 }]);
    let s = setSection({ ...song, sections: [] }, 0, 3, 'Intro');
    s = setSection(s, 4, 11, 'Verse');
    s = setSection(s, 12, 15, 'Chorus');
    expect(sectionRanges(s).map((r) => [r.name, r.startBar, r.endBar])).toEqual([['Intro', 0, 4], ['Verse', 4, 12], ['Chorus', 12, 16]]);
    const mid = setSection(s, 6, 7, 'Solo');
    expect(sectionRanges(mid).map((r) => [r.name, r.startBar])).toEqual([['Intro', 0], ['Verse', 4], ['Solo', 6], ['Verse', 8], ['Chorus', 12]]);
  });
});

// ---------------- band ----------------

function withSections(song: Song): Song {
  let s = setSection({ ...song, sections: [] }, 0, 7, 'Verse');
  s = setSection(s, 8, 15, 'Chorus');
  return s;
}

function trackPitches(t: Track) {
  const out: number[] = [];
  for (const st of t.staves) for (const m of st.measures) for (const v of m.voices) for (const b of v.beats) for (const n of b.notes) out.push(n.pitch);
  return out;
}

describe.each(STYLE_IDS)('style %s', (style: StyleId) => {
  const song = withSections(ode());
  const settings = defaultBand(style, song.tracks[0].id, 42);
  const out = generateBand(song, settings);
  const gen = out.tracks.filter((t) => t.generated);
  const role = (r: string) => gen.find((t) => t.generated!.role === r)!;

  it('makes drums, bass, rhythm and lead; source kept and muted', () => {
    expect(gen.map((t) => t.generated!.role).sort()).toEqual(['bass', 'drums', 'lead', 'rhythm']);
    expect(out.tracks[0].mixer.mute).toBe(true);
    expect(out.tracks[0].staves).toStrictEqual(song.tracks[0].staves);
    for (const t of gen) {
      expect(t.staves[0].measures.length).toBe(song.bars.length);
      barLengthsOk(out, t);
      expect(trackPitches(t).length).toBeGreaterThan(10);
    }
  });

  it('notes are in range for each instrument', () => {
    for (const t of gen.filter((x) => !x.instrument.percussion)) {
      const [lo, hi] = instrumentRange(t.instrument.id);
      for (const p of trackPitches(t)) {
        expect(p).toBeGreaterThanOrEqual(lo);
        expect(p).toBeLessThanOrEqual(hi);
      }
    }
    const drumNotes = new Set(trackPitches(role('drums')));
    for (const p of drumNotes) expect(Object.values(GM)).toContain(p);
    expect(role('drums').instrument.percussion).toBe(true);
  });

  it('guitar/bass parts have playable string/fret positions', () => {
    for (const t of gen.filter((x) => x.tuning)) {
      for (const st of t.staves) for (const m of st.measures) for (const v of m.voices) for (const b of v.beats) {
        const strings = new Set<number>();
        for (const n of b.notes) {
          expect(n.string).toBeDefined();
          expect(t.tuning![n.string! - 1] + n.fret!).toBe(n.pitch);
          expect(n.fret!).toBeGreaterThanOrEqual(0);
          expect(n.fret!).toBeLessThanOrEqual(24);
          expect(strings.has(n.string!)).toBe(false);
          strings.add(n.string!);
        }
        const frets = b.notes.map((n) => n.fret!).filter((f) => f > 0);
        if (frets.length > 1) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('bass and rhythm play chord tones where expected', () => {
    const chords = out.chordSymbols;
    const check = (t: Track, onBeatOnly: boolean, minPct: number) => {
      let hits = 0;
      let total = 0;
      for (const b of beatsOf(out, t)) {
        if (!b.notes.length || b.notes.every((n) => n.tieFromPrevious)) continue;
        const local = b.tick - barStartTicks(out)[b.bar];
        if (onBeatOnly && local % 960 !== 0) continue;
        const c = parseChord(chordAt(chords, b.bar, local)!.name)!;
        // 6th allowed (boogie / jazz shells), b7 for the blues boogie.
        const tones = new Set([...chordTones(c), c.bass, (c.root + 9) % 12, ...(style === 'blues' ? [(c.root + 10) % 12] : [])]);
        for (const n of b.notes) {
          total++;
          if (tones.has(n.pitch % 12)) hits++;
        }
      }
      const pct = (100 * hits) / Math.max(1, total);
      expect(pct, `${t.name}: ${hits}/${total}`).toBeGreaterThanOrEqual(minPct);
    };
    // Downbeats of the bass: the chord root (or a chord tone). Walking/boogie lines pass through other notes in between.
    const bass = role('bass');
    const firstBeats = beatsOf(out, bass).filter((b) => b.tick === barStartTicks(out)[b.bar] && b.notes.length && !b.notes[0].tieFromPrevious);
    for (const b of firstBeats) {
      const c = parseChord(chordAt(chords, b.bar, 0)!.name)!;
      // Blues boogie runs 1-3-5-6 | b7-6-5-3: its second bar starts on the b7.
      const ok = [c.bass, ...(style === 'blues' ? [(c.root + 10) % 12] : [])];
      expect(ok).toContain(b.notes[0].pitch % 12);
    }
    check(bass, true, style === 'jazz' || style === 'blues' ? 60 : 95);
    check(role('rhythm'), false, style === 'blues' ? 70 : 95);
  });

  it('lead = the melody moved to the lead instrument', () => {
    const lead = role('lead');
    const mel = trackPitches(lead);
    const src = splitTrack(song, song.tracks[0].id).tracks.find((t) => t.derived?.part === 'melody')!;
    const orig = trackPitches(src);
    expect(mel.length).toBe(orig.length);
    const shift = mel[0] - orig[0];
    expect(shift % 12).toBe(0);
    mel.forEach((p, i) => expect(p - orig[i]).toBe(shift));
  });

  it('drums: fill before each new section and a crash on its downbeat', () => {
    const drums = role('drums');
    const bar = (i: number) => drums.staves[0].measures[i].voices[0].beats.flatMap((b) => b.notes.map((n) => n.pitch));
    expect(bar(8).includes(GM.crash)).toBe(true); // Chorus starts at bar 9
    const fill = bar(7);
    expect(fill.some((p) => p === GM.tomHi || p === GM.tomMid || p === GM.tomFloor || p === GM.tomLow) || fill.filter((p) => p === GM.snare).length >= 4).toBe(true);
  });

  it('is deterministic per seed and different with another seed', () => {
    const again = generateBand(song, settings);
    expect(again).toStrictEqual(out);
    const other = generateBand(song, { ...settings, seed: 7 });
    const differs = other.tracks.filter((t) => t.generated).some((t, i) => hashOf(t.staves) !== hashOf(gen[i].staves));
    expect(differs).toBe(true);
  });

  it('sets the swing feel for the style', () => {
    expect(out.playback?.swing ?? 0).toBe({ rock: 0, blues: 1, country: 0, jazz: 0.7, pop: 0 }[style]);
  });
});

describe('band options', () => {
  const song = withSections(ode());
  it('bass follows kick: bass notes start exactly on kick hits', () => {
    const out = generateBand(song, { ...defaultBand('rock', 't1', 3), bassFollowsKick: true, ending: false });
    const drums = out.tracks.find((t) => t.generated?.role === 'drums')!;
    const bass = out.tracks.find((t) => t.generated?.role === 'bass')!;
    const kicks = new Set(beatsOf(out, drums).filter((b) => b.notes.some((n) => n.pitch === GM.kick)).map((b) => b.tick));
    const starts = beatsOf(out, bass).filter((b) => b.notes.length && !b.notes[0].tieFromPrevious).map((b) => b.tick);
    expect(starts.length).toBeGreaterThan(16);
    for (const t of starts) expect(kicks.has(t)).toBe(true);
  });
  it('ending holds the final chord', () => {
    const out = generateBand(song, defaultBand('pop', 't1', 3));
    const rhythm = out.tracks.find((t) => t.generated?.role === 'rhythm')!;
    const last = rhythm.staves[0].measures[15].voices[0].beats;
    expect(last.length).toBe(1);
    expect(last[0].duration.base).toBe(1);
  });
  it('complexity changes the part', () => {
    const base = defaultBand('rock', 't1', 3);
    const simple = generateBand(song, { ...base, players: base.players.map((p) => ({ ...p, complexity: 'simple' })) });
    const busy = generateBand(song, { ...base, players: base.players.map((p) => ({ ...p, complexity: 'busy' })) });
    const count = (s: Song, r: string) => trackPitches(s.tracks.find((t) => t.generated?.role === r)!).length;
    expect(count(busy, 'drums')).toBeGreaterThan(count(simple, 'drums'));
    expect(count(busy, 'rhythm')).toBeGreaterThan(count(simple, 'rhythm'));
  });
  it('writes recognised chords when the song has none', () => {
    const out = generateBand({ ...song, chordSymbols: [] }, defaultBand('rock', 't1', 1));
    expect(out.chordSymbols.length).toBeGreaterThanOrEqual(16);
    expect(out.chordSymbols.every((c) => c.source === 'detected')).toBe(true);
  });
  it('regenerate one section changes only those bars; one player only that track', () => {
    const out = generateBand(song, defaultBand('rock', 't1', 3));
    const re = regenerate(out, { sectionStartBar: 8 }, 99);
    for (const [i, t] of out.tracks.entries()) {
      const r = re.tracks[i];
      for (let b = 0; b < 8; b++) expect(r.staves.map((s) => s.measures[b])).toStrictEqual(t.staves.map((s) => s.measures[b]));
    }
    const drumsBefore = out.tracks.find((t) => t.generated?.role === 'drums')!;
    const drumsAfter = re.tracks.find((t) => t.generated?.role === 'drums')!;
    expect(hashOf(drumsAfter.staves)).not.toBe(hashOf(drumsBefore.staves));
    expect(drumsAfter.generated!.sectionSeeds).toEqual({ '8': 99 });
    expect(editedGeneratedTracks(re)).toEqual([]);
    const onlyBass = regenerate(out, { role: 'bass' }, 55);
    out.tracks.forEach((t, i) => {
      if (t.generated?.role !== 'bass') expect(onlyBass.tracks[i]).toStrictEqual(t);
    });
  });
  it('detects hand edits to a generated track', () => {
    const out = generateBand(song, defaultBand('rock', 't1', 3));
    expect(editedGeneratedTracks(out)).toEqual([]);
    const edited = structuredClone(out);
    const bass = edited.tracks.find((t) => t.generated?.role === 'bass')!;
    bass.staves[0].measures[0].voices[0].beats[0].notes[0].pitch += 2;
    expect(editedGeneratedTracks(edited).map((t) => t.id)).toEqual([bass.id]);
    // Instrument and mixer changes are not "edits".
    const mixed = structuredClone(out);
    mixed.tracks.find((t) => t.generated?.role === 'bass')!.mixer.volume = 0.2;
    expect(editedGeneratedTracks(mixed)).toEqual([]);
  });
  it('a song with chords from the file uses them', () => {
    const out = generateBand(song, defaultBand('rock', 't1', 3));
    expect(out.chordSymbols).toEqual(song.chordSymbols);
  });
  it('jazz/blues/country lead instruments exist in the catalog', () => {
    for (const s of STYLE_IDS) for (const p of defaultBand(s).players) expect(findInstrument(p.instrumentId)).toBeDefined();
  });
});

describe('save/load + undo (Round 2 data)', () => {
  it('generated tags, sections, chords, swing and SoundFont survive save/reopen', () => {
    let song = withSections(ode());
    song = applyDetectedChords(song, detectChords(song), true);
    song = setChordSymbol(song, 3, 0, 'G7');
    song = splitTrack(song, 't1');
    song = generateBand(song, defaultBand('jazz', 't1', 5));
    song = regenerate(song, { sectionStartBar: 8 }, 77);
    song.playback = { swing: 0.5, soundFont: 'C:\\Sounds\\My Font.sf2' };
    const back = parseProject(serializeProject(song));
    expect(back).toStrictEqual(song);
    expect(back.tracks.some((t) => t.generated?.sectionSeeds)).toBe(true);
    expect(back.tracks.some((t) => t.derived)).toBe(true);
    expect(JSON.parse(serializeProject(song)).schemaVersion).toBe(2);
  });
  it('a v1 project still opens', () => {
    const text = serializeProject(ode()).replace('"schemaVersion": 2', '"schemaVersion": 1');
    expect(parseProject(text).tracks.length).toBe(1);
  });
  it('undo after Generate restores the song exactly; redo brings the band back', () => {
    const s0 = withSections(ode());
    const h = new History(s0);
    const snap = JSON.stringify(s0);
    const s1 = h.apply(generateBand(h.present, defaultBand('rock', 't1', 1)), 'Generate band');
    h.apply(regenerate(h.present, { role: 'drums' }, 2), 'Regenerate');
    expect(h.undo()).toBe(s1);
    expect(JSON.stringify(h.undo())).toBe(snap);
    expect(h.redo()).toBe(s1);
  });
});

import { swingTick } from '../../src/render/swing';

describe('swing (playback only)', () => {
  it('moves off-beat 8ths, never beats', () => {
    expect(swingTick(0, 1)).toBe(0);
    expect(swingTick(960, 1)).toBe(960);
    expect(swingTick(480, 0)).toBe(480);
    expect(swingTick(480, 1)).toBe(640); // triplet feel: 2/3 of the beat
    expect(swingTick(960 + 480, 0.5)).toBe(960 + 560);
    for (let t = 0; t < 1920; t += 60) expect(swingTick(t + 60, 0.7)).toBeGreaterThan(swingTick(t, 0.7)); // order kept
  });
});

describe('guitar chord shapes', () => {
  it('rock power chords sit on adjacent strings', () => {
    const out = generateBand(ode(), { ...defaultBand('rock', 't1', 1), ending: false });
    const rhythm = out.tracks.find((t) => t.generated?.role === 'rhythm')!;
    for (const m of rhythm.staves[0].measures) for (const b of m.voices[0].beats) {
      if (b.notes.length < 2) continue;
      const strings = b.notes.map((n) => n.string!).sort((x, y) => x - y);
      strings.forEach((s, i) => i && expect(s - strings[i - 1]).toBe(1));
      expect(b.notes.map((n) => n.pitch - b.notes[0].pitch).sort((x, y) => x - y)).toEqual([0, 7, 12]);
    }
  });
});
