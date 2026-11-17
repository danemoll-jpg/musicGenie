// Round 7: lyrics, Rocksmith vocals, singing, vocals from recordings, accuracy, "describe it", sounds.
import { describe, expect, it } from 'vitest';
import { readTestFile } from './helpers';
import { exportGuitarPro, exportMidi, exportMusicXml } from '../../src/export';
import { importFile } from '../../src/import';
import {
  lyricEvents, lyricSlots, moveSyllables, parseProject, pasteLyrics, serializeProject, setSyllable, splitLyrics, syllabify,
  verseSyllables, rocksmithVocals, rsLyricText, vocalsTrackFromRs, barsFromBeats, tempoPoints, msAtTick, songEndTick, type Song,
  parseDescription, planToChart, planBars, planBand, sanitizePlan, chartToSong, defaultBand, generateBand, type SongPlan,
} from '../../src/model';

export const ODE_VERSE_1 = 'Joyful, joyful, we adore thee, God of glory, Lord of love; Hearts unfold like flowers before thee, ' +
  'Opening to the sun above. Melt the clouds of sin and sadness; drive the dark of doubt away; ' +
  'Giver of immortal gladness, fill us with the light of day!';
// Verse 2 with explicit hyphens and a held syllable ("love_" = two notes).
export const ODE_VERSE_2 = 'All Thy works with joy sur-round Thee, earth and heav-en re-flect Thy rays, stars and an-gels sing a-round Thee, ' +
  'cen-ter of un-bro-ken praise. Field and for-est, vale and moun-tain, flow-ery mead-ow, flash-ing sea, chant-ing bird and flow-ing foun-tain, call us to re-joice_ in Thee.';

const ode = () => importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));

function withLyrics(): Song {
  let s = ode();
  const id = s.tracks[0].id;
  s = pasteLyrics(s, id, 0, ODE_VERSE_1).song;
  s = pasteLyrics(s, id, 1, ODE_VERSE_2).song;
  return s;
}

describe('lyrics: syllables', () => {
  it('splits words into syllables', () => {
    expect(syllabify('joyful,')).toEqual(['joy', 'ful,']);
    expect(syllabify('glory')).toEqual(['glo', 'ry']);
    expect(syllabify('adore')).toEqual(['a', 'dore']);
    expect(syllabify('before')).toEqual(['be', 'fore']);
    expect(syllabify('above.')).toEqual(['a', 'bove.']);
    expect(syllabify('unfold')).toEqual(['un', 'fold']);
    expect(syllabify('thee')).toEqual(['thee']);
    expect(syllabify('hearts')).toEqual(['hearts']);
    expect(syllabify('gladness,')).toEqual(['glad', 'ness,']);
  });
  it('keeps typed hyphens, "_" holds, "*" skips', () => {
    expect(splitLyrics('Freu-de, schö-ner')).toEqual(['Freu-', 'de,', 'schö-', 'ner']);
    expect(splitLyrics('love_ me * well--known', false)).toEqual(['love', '_', 'me', '', 'well-known']);
    expect(splitLyrics('a _ _ b', false)).toEqual(['a', '_', '_', 'b']);
  });
});

describe('lyrics: paste, edit, save, export', () => {
  it('pastes verses onto the melody notes in order (tied notes and rests skipped)', () => {
    const s = withLyrics();
    const t = s.tracks[0];
    const slots = lyricSlots(s, t);
    const v1 = verseSyllables(s, t, 0);
    expect(v1.slice(0, 6)).toEqual(['Joy-', 'ful,', 'joy-', 'ful,', 'we', 'a-']);
    const ev = lyricEvents(s, t, 1);
    const love = ev.find((e) => e.text === 'joice')!;
    expect(love.notes.length).toBe(2); // held over two notes
    expect(slots.length).toBeGreaterThan(50);
  });

  it('typing and dragging syllables', () => {
    let s = withLyrics();
    const id = s.tracks[0].id;
    s = setSyllable(s, id, 0, 4, 'you');
    expect(verseSyllables(s, s.tracks[0], 0)[4]).toBe('you');
    const before = verseSyllables(s, s.tracks[0], 0);
    s = moveSyllables(s, id, 0, 4, 6); // drag "you" two notes right: everything after follows
    const after = verseSyllables(s, s.tracks[0], 0);
    expect(after.slice(4, 8)).toEqual(['', '', 'you', before[5]]);
    s = moveSyllables(s, id, 0, 6, 4); // and back
    expect(verseSyllables(s, s.tracks[0], 0).slice(0, 40)).toEqual(before.slice(0, 40));
  });

  it('save/reopen keeps every syllable; v6 "lyric" moves into lyrics[0]', () => {
    const s = withLyrics();
    expect(parseProject(serializeProject(s))).toEqual(s);
    const old = JSON.parse(serializeProject(ode()));
    old.schemaVersion = 6;
    const b0 = old.song.tracks[0].staves[0].measures[0].voices[0].beats[0];
    b0.lyric = b0.lyrics[0];
    delete b0.lyrics;
    const re = parseProject(JSON.stringify(old));
    expect(re.tracks[0].staves[0].measures[0].voices[0].beats[0].lyrics).toEqual(['Joy']);
  });

  const sylls = (s: Song, v: number) => verseSyllables(s, s.tracks[0], v).filter(Boolean);
  it('MusicXML export/re-import keeps both verses, hyphens and holds', () => {
    const s = withLyrics();
    const xml = exportMusicXml(s);
    expect(xml).toContain('<syllabic>begin</syllabic><text>Joy</text>');
    expect(xml).toContain('<extend/>');
    const back = importFile('x.musicxml', new TextEncoder().encode(xml));
    expect(sylls(back, 0)).toEqual(sylls(s, 0).filter((x) => x !== '_'));
    expect(sylls(back, 1)).toEqual(sylls(s, 1).filter((x) => x !== '_'));
  });
  it('Guitar Pro export/re-import keeps both verses', () => {
    const s = withLyrics();
    const back = importFile('x.gp', exportGuitarPro(s));
    expect(sylls(back, 0)).toEqual(sylls(s, 0).filter((x) => x !== '_'));
    expect(sylls(back, 1)).toEqual(sylls(s, 1).filter((x) => x !== '_'));
  });
  it('MIDI export/re-import keeps verse 1 (lyric events)', () => {
    const s = withLyrics();
    const back = importFile('x.mid', exportMidi(s));
    // One MIDI piano track is split at middle C on import: read the syllables of both staves in time order.
    const t = back.tracks.find((x) => verseSyllables(back, x, 0).some(Boolean))!;
    const all = t.staves.flatMap((_, si) => lyricSlots(back, t, si).map((sl) => ({ tick: sl.tick, text: t.staves[si].measures[sl.bar].voices[0].beats[sl.beat].lyrics?.[0] ?? '' })));
    expect(all.sort((a, b) => a.tick - b.tick).map((x) => x.text).filter(Boolean)).toEqual(sylls(s, 0).filter((x) => x !== '_'));
  });
});

describe('Rocksmith vocals', () => {
  it('lyrics -> vocals (lines, hyphens, game font) -> Vocals track with the same syllables', () => {
    const s = withLyrics();
    const t = s.tracks[0];
    const v = rocksmithVocals(s, t.id, 2000, 0);
    expect(v.length).toBe(lyricEvents(s, t, 0).length);
    expect(v[0]).toMatchObject({ time: 2000, lyric: 'Joy-' });
    expect(v.filter((x) => x.lyric.endsWith('+')).length).toBeGreaterThan(5);
    expect(v.every((x) => [...x.lyric].every((c) => c !== '’'))).toBe(true);
    expect(rsLyricText('don’t – “łódź”')).toBe("don't - \"ódz\"");
    // Back in: same beats (no lead-in here), same syllables in order.
    const v0 = rocksmithVocals(s, t.id, 0, 0);
    const beats: [number, number][] = [];
    const pts = tempoPoints(s);
    for (let tick = 0; tick < songEndTick(s); tick += 960) beats.push([msAtTick(pts, tick), tick % 3840 === 0 ? 0 : -1]);
    const { grid } = barsFromBeats(beats);
    const back = vocalsTrackFromRs(s, v0, grid, 'v')!;
    const sy = verseSyllables(s, back.track, 0).filter(Boolean);
    expect(sy).toEqual(v0.map((x) => x.lyric.replace(/\+$/, '')));
  });
});

describe('"Describe a song" parser (15 descriptions)', () => {
  const P = (s: string) => parseDescription(s);
  const roles = (p: SongPlan) => p.players.map((x) => x.role + ':' + x.instrumentId).sort();
  const total = (p: SongPlan) => planBars(p);
  it('1. 12-bar blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses', () => {
    const p = P('12-bar blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses');
    expect(p).toMatchObject({ key: 'E', mode: 'major', bpm: 110, feel: 'shuffle', style: 'blues', timeSig: [4, 4] });
    expect(p.sections).toEqual([{ name: 'Chorus', bars: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'], repeat: 3 }]);
    expect(roles(p)).toEqual(['bass:fingered-bass', 'drums:drum-kit', 'lead:acoustic-grand-piano', 'rhythm:electric-guitar-clean']);
    expect(planToChart(p)).toContain('E7 | E7 | E7 | E7 | A7 | A7 | E7 | E7 | B7 | A7 | E7 | B7 :| x3');
  });
  it('2. slow minor blues in A', () => {
    const p = P('a slow minor blues in A');
    expect(p).toMatchObject({ key: 'A', mode: 'minor', bpm: 72, style: 'blues' });
    expect(p.sections[0].bars[0]).toBe('i7');
    expect(planToChart(p)).toContain('Am7');
  });
  it('3. jazz ii-V-I in Bb at 160, swing', () => {
    const p = P('jazz ii-V-I in Bb at 160 bpm, swing, upright bass and drums');
    expect(p).toMatchObject({ key: 'Bb', bpm: 160, feel: 'swing', style: 'jazz' });
    expect(planToChart(p)).toContain('Cm7 | F7 | Bbmaj7');
    expect(roles(p)).toEqual(['bass:acoustic-bass', 'drums:drum-kit']);
  });
  it('4. AABA in F, 32-bar form', () => {
    const p = P('an AABA tune in F at 140');
    expect(p.sections.map((s) => s.name)).toEqual(['A', 'A', 'B', 'A']);
    expect(total(p)).toBe(32);
    expect(p.key).toBe('F');
  });
  it('5. verse/chorus pop song in G with a bridge', () => {
    const p = P('pop song in G, verse/chorus with a bridge, 96 bpm, keys bass drums');
    expect(p.style).toBe('pop');
    expect(p.sections.map((s) => s.name)).toEqual(['Intro', 'Verse', 'Chorus', 'Verse', 'Bridge', 'Chorus', 'Outro']);
    expect(p.bpm).toBe(96);
  });
  it('6. country waltz in D', () => {
    const p = P('country waltz in D with acoustic guitar and fiddle');
    expect(p).toMatchObject({ style: 'country', timeSig: [3, 4], key: 'D' });
    expect(roles(p)).toEqual(['lead:violin', 'rhythm:steel-guitar']);
  });
  it('7. key of C# minor, andalusian cadence', () => {
    const p = P('key of C# minor, andalusian cadence, fast rock');
    expect(p).toMatchObject({ key: 'C#', mode: 'minor', style: 'rock', bpm: 144 });
    expect(planToChart(p)).toContain('C#m | B | A | G#');
  });
  it('8. I-V-vi-IV in D major, 4 times', () => {
    const p = P('I-V-vi-IV in D major, 4 times, 120 bpm');
    expect(p.sections[0]).toEqual({ name: 'A', bars: ['I', 'V', 'vi', 'IV'], repeat: 4 });
    expect(planToChart(p)).toContain('D | A | Bm | G');
  });
  it('9. 50s progression in Eb, doo-wop, 6/8', () => {
    const p = P('doo-wop 50s progression in Eb, 6/8 ballad');
    expect(p).toMatchObject({ key: 'Eb', timeSig: [6, 8], bpm: 66 });
    expect(planToChart(p)).toContain('Eb | Cm | Ab | Bb');
  });
  it('10. punk in E, no bass, very fast', () => {
    const p = P('punk in E, very fast, distorted guitar and drums, no bass');
    expect(p).toMatchObject({ style: 'rock', bpm: 180 });
    expect(roles(p)).toEqual(['drums:drum-kit', 'rhythm:distortion-guitar']);
  });
  it('11. quick-change blues in G, twice, called "Morning Shuffle"', () => {
    const p = P('quick-change blues in G, twice, called "Morning Shuffle"');
    expect(p.title).toBe('Morning Shuffle');
    expect(p.sections[0].repeat).toBe(2);
    expect(p.sections[0].bars[1]).toBe('IV7');
  });
  it('12. canon in D with strings', () => {
    const p = P('Pachelbel canon in D with strings and cello');
    expect(planToChart(p)).toContain('D | A | Bm | F#m | G | D | G | A');
    expect(roles(p)).toEqual(['lead:cello', 'rhythm:string-ensemble']);
  });
  it('13. 16-bar three-chord rock in A with an intro and ending', () => {
    const p = P('16-bar three-chord rock in A with an intro and an ending');
    expect(p.sections.map((s) => s.name)).toEqual(['Intro', 'A', 'Outro']);
    expect(p.sections[1].bars.length).toBe(16);
  });
  it('14. defaults: just "something funky"', () => {
    const p = P('something funky');
    expect(p.style).toBe('pop');
    expect(p.notes.length).toBeGreaterThan(1);
    expect(p.players.length).toBe(3);
  });
  it('15. sax and organ jazz in F, medium tempo, 3/4', () => {
    const p = P('medium tempo jazz in F in 3/4 with organ and tenor sax');
    expect(p).toMatchObject({ bpm: 100, timeSig: [3, 4], style: 'jazz', feel: 'swing' });
    expect(roles(p)).toEqual(['lead:tenor-sax', 'rhythm:drawbar-organ']);
  });
  it('builds a playable song from a plan (chart -> band)', () => {
    const p = P('12-bar blues in E, shuffle at 110, guitar, bass, piano and drums, 3 choruses');
    const { song, errors } = chartToSong(planToChart(p), { title: p.title, bpm: p.bpm });
    expect(errors).toEqual([]);
    expect(song.bars.length).toBe(12);
    const { band, swing } = planBand(p, defaultBand('rock'));
    const full = generateBand(song, band);
    expect(full.tracks.length).toBe(4);
    expect(swing).toBe(1);
    expect(sanitizePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
