// Round 7 (continued): pure parts of singing, vocals from recordings, accuracy refinements, sounds.
import { describe, expect, it } from 'vitest';
import { readTestFile } from './helpers';
import { importFile } from '../../src/import';
import { tempoPoints, msAtTick, lyricSlots, pasteLyrics, placeWords, setTrackSound, trackBank, verseSyllables, librarySoundFiles, parseProject, serializeProject } from '../../src/model';
import { centOffset, detectTuning, fixBassOctaves, guitarLines, refineOnsets } from '../../src/ml/refine';
import { f0ToNotes } from '../../src/ml/voice';
import { layoutPhrases, parseDsDict, pitchCurve, splitWordPhonemes, wordPhonemes, frameDurations, DEFAULT_SING } from '../../src/ml/sing';
import { makeDecoder } from '../../src/ml/whisper';
import { moveSf2Banks, parseSfz, sf2Presets, sfzKey, sfzToSf2, writeSf2 } from '../../src/render/sf2';
import { exportSvp, exportUstx } from '../../src/export/vocal';
import { toAlphaTabScore } from '../../src/render/toAlphaTab';
import * as alphaTab from '@coderline/alphatab';

const SR = 22050;
const tone = (len: number, parts: [number, number][], sr = SR) => {
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) for (const [f, a] of parts) x[i] += a * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
};
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

describe('accuracy refinements', () => {
  it('finds a recording 30 cents sharp (and in tune)', () => {
    const c = 2 ** (30 / 1200);
    const x = tone(SR * 3, [[hz(45) * c, 0.4], [hz(57) * c, 0.3], [hz(64) * c, 0.2]]);
    expect(Math.abs(centOffset(x, SR).cents - 30)).toBeLessThan(3);
    expect(Math.abs(centOffset(tone(SR * 3, [[hz(45), 0.4], [hz(52), 0.3]]), SR).cents)).toBeLessThan(3);
  });
  it('moves a bass note reported an octave up down to its fundamental', () => {
    // E1 (41.2 Hz) with a stronger 2nd harmonic: basic-pitch would say E2.
    const x = tone(SR, [[hz(28), 0.3], [hz(40), 0.6]]);
    const r = fixBassOctaves([{ startS: 0.1, endS: 0.8, pitch: 40, amplitude: 1 }], x, SR);
    expect(r.notes[0].pitch).toBe(28);
    // A real E2 (no energy at E1) stays.
    const y = tone(SR, [[hz(40), 0.6], [hz(52), 0.2]]);
    expect(fixBassOctaves([{ startS: 0.1, endS: 0.8, pitch: 40, amplitude: 1 }], y, SR).notes[0].pitch).toBe(40);
  });
  it('guitar: single-note lines keep one note per onset, chords stay chords', () => {
    const n = (t: number, p: number, a = 0.5) => ({ startS: t, endS: t + 0.2, pitch: p, amplitude: a });
    const line = [n(0, 52), n(0.01, 64, 0.3), n(0.3, 55), n(0.6, 57), n(0.61, 69, 0.2)];
    expect(guitarLines(line).notes.map((x) => x.pitch)).toEqual([52, 55, 57]);
    const chords = [0, 0.5, 1].flatMap((t) => [n(t, 40), n(t + 0.01, 47), n(t + 0.02, 52), n(t + 0.02, 56)]);
    expect(guitarLines(chords).notes.length).toBe(12);
  });
  it('moves onsets to the attack', () => {
    const x = new Float32Array(SR * 2);
    for (const at of [0.5, 1.2]) for (let i = 0; i < 4000; i++) x[Math.round(at * SR) + i] = (Math.random() * 2 - 1) * Math.exp(-i / 800);
    const r = refineOnsets([{ startS: 0.54, endS: 0.9, pitch: 50, amplitude: 1 }, { startS: 1.17, endS: 1.5, pitch: 52, amplitude: 1 }], x, SR);
    expect(Math.abs(r.notes[0].startS - 0.5)).toBeLessThan(0.012);
    expect(Math.abs(r.notes[1].startS - 1.2)).toBeLessThan(0.012);
  });
  it('detects drop D, Eb standard and E standard from the notes', () => {
    const notes = (ps: number[]) => ps.flatMap((p) => Array.from({ length: 5 }, () => ({ pitch: p })));
    expect(detectTuning(notes([38, 45, 50, 38, 40, 43]), 'guitar').name).toBe('Drop D');
    expect(detectTuning(notes([27, 32, 34, 37, 39]), 'bass').name).toBe('Eb standard');
    expect(detectTuning(notes([28, 33, 35, 40, 43]), 'bass').name).toBe('E standard');
  });
});

describe('vocals from a recording', () => {
  it('f0 -> notes: pitch steps, same-pitch syllables split at the energy dip, tuning offset', () => {
    const f0 = new Float32Array(300);
    const e = new Float32Array(300).fill(0.5);
    const c = 2 ** (20 / 1200);
    for (let i = 0; i < 100; i++) f0[i] = hz(60) * c;
    for (let i = 100; i < 200; i++) f0[i] = hz(62) * c;
    for (let i = 200; i < 300; i++) f0[i] = hz(62) * c;
    for (let i = 197; i < 203; i++) e[i] = 0.1; // a dip between two syllables on D
    const r = f0ToNotes(f0, e);
    expect(r.notes.map((n) => n.pitch)).toEqual([60, 62, 62]);
    expect(Math.abs(r.centOffset - 20)).toBeLessThan(2);
    expect(Math.abs(r.notes[1].startS - 1.0)).toBeLessThan(0.05);
  });
  it('places recognised words on the notes (syllables, held notes)', () => {
    let s = importFile('o.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
    const t = s.tracks[0];
    const sl = lyricSlots(s, t);
    const pts = tempoPoints(s);
    const ms = (i: number) => msAtTick(pts, sl[i].tick);
    const r = placeWords(s, t.id, [{ word: 'Joyful', ms: ms(0) }, { word: 'joyful', ms: ms(2) }, { word: 'we', ms: ms(4) }, { word: 'adore', ms: ms(5), endMs: ms(6) + 300 }]);
    s = r.song;
    expect(verseSyllables(s, s.tracks[0], 0).slice(0, 8)).toEqual(['Joy-', 'ful', 'joy-', 'ful', 'we', 'a-', 'dore', '']);
  });
  it('decodes byte-level BPE tokens', () => {
    const dec = makeDecoder({ 'Ġjoy': 1, 'ful': 2, 'Ġé': 3 });
    expect(dec([1, 2])).toBe(' joyful');
  });
});

describe('singing input', () => {
  const dict = parseDsDict([
    'symbols:', '- symbol: SP', '  type: vowel', '- symbol: AP', '  type: vowel',
    ...['en/jh', 'en/f', 'en/l', 'en/g', 'en/d', 'en/r'].flatMap((x) => [`- symbol: ${x}`, '  type: fricative']),
    ...['en/oy', 'en/ax', 'en/aa', 'en/ao', 'en/ow'].flatMap((x) => [`- symbol: ${x}`, '  type: vowel']),
    'entries:', '- grapheme: joyful', '  phonemes:', '  - en/jh', '  - en/oy', '  - en/f', '  - en/ax', '  - en/l',
    '- grapheme: god', '  phonemes:', '  - en/g', '  - en/aa', '  - en/d',
  ].join('\n'));
  it('reads the dictionary and splits words over syllables', () => {
    expect(dict.words.get('joyful')).toEqual(['en/jh', 'en/oy', 'en/f', 'en/ax', 'en/l']);
    expect(splitWordPhonemes(dict, dict.words.get('joyful')!, 2)).toEqual([['en/jh', 'en/oy'], ['en/f', 'en/ax', 'en/l']]);
    expect(wordPhonemes(dict, 'Lord').length).toBeGreaterThan(1); // letter rules for unknown words
  });
  it('lays phonemes out with the vowel on the beat and the pitch on the notes', () => {
    const sylls = [
      { text: 'Joy', hyphen: true, velocity: 96, notes: [{ ms: 1000, durMs: 500, pitch: 64 }] },
      { text: 'ful', hyphen: false, velocity: 96, notes: [{ ms: 1500, durMs: 500, pitch: 64 }] },
      { text: 'God', hyphen: false, velocity: 96, notes: [{ ms: 3000, durMs: 1000, pitch: 67 }] },
    ];
    const ph = layoutPhrases(dict, sylls, 0.4);
    expect(ph.length).toBe(2);
    const oy = ph[0].phonemes.find((p) => p.ph === 'en/oy')!;
    expect(Math.abs(oy.start - 1000)).toBeLessThan(1);
    const durs = frameDurations(ph[0]);
    expect(durs.every((d) => d >= 1)).toBe(true);
    const curve = pitchCurve(ph[1], durs.reduce((a, b) => a, 0) + 200, DEFAULT_SING);
    const mid = curve[Math.round((3400 - ph[1].startMs) / (512 / 44.1))];
    expect(Math.abs(mid - 67)).toBeLessThan(0.4); // vibrato around G4
  });
  it('exports .ustx and .svp with every syllable', () => {
    let s = importFile('o.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
    s = pasteLyrics(s, s.tracks[0].id, 0, 'Joy-ful joy-ful we a-dore thee').song;
    const u = exportUstx(s, s.tracks[0]);
    expect(u).toContain("lyric: 'Joy'");
    expect((u.match(/lyric:/g) ?? []).length).toBe(8);
    const v = JSON.parse(exportSvp(s, s.tracks[0]));
    expect(v.tracks[0].mainGroup.notes.map((n: { lyrics: string }) => n.lyrics)).toEqual(['Joy', 'ful', 'joy', 'ful', 'we', 'a', 'dore', 'thee']);
    expect(v.tracks[0].mainGroup.notes[1].onset).toBe(705600000);
  });
});

describe('sound library', () => {
  const sine = () => {
    const d = new Int16Array(4410);
    for (let i = 0; i < d.length; i++) d[i] = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / 44100));
    return d;
  };
  it('writes an SF2 alphaTab can read; banks move', () => {
    const b = writeSf2('Test Sine', [{ name: 'sine', data: sine(), rate: 44100, rootKey: 69, correction: 0, loopStart: 0, loopEnd: 4400 }], [{ sample: 0, loKey: 0, hiKey: 127, loVel: 1, hiVel: 127, loop: 1, release: 0.2 }]);
    expect(sf2Presets(b)).toEqual([{ name: 'Test Sine', bank: 0, program: 0 }]);
    expect(sf2Presets(moveSf2Banks(b, 512))[0].bank).toBe(512);
  });
  it('reads SFZ regions (headers inherit, key names, defines)', () => {
    const { regions, defaultPath } = parseSfz('<control> default_path=samples/\n#define $V 80\n<group> ampeg_release=0.5 lovel=1 hivel=$V\n<region> sample=c 4.wav key=c4\n<region> sample=d4.wav lokey=61 hikey=63 pitch_keycenter=62\n<region> sample=rel.wav trigger=release');
    expect(defaultPath).toBe('samples/');
    expect(regions.length).toBe(2);
    expect(regions[0]).toMatchObject({ sample: 'c 4.wav', key: 'c4', hivel: '80', ampeg_release: '0.5' });
    expect(sfzKey('c4', 0)).toBe(60);
    expect(sfzKey('F#3', 0)).toBe(54);
    const sf = sfzToSf2('x', regions, new Map([['c 4.wav', { data: new Float32Array(1000).fill(0.1), rate: 44100 }]]), (r) => r.sample);
    expect(sf2Presets(sf).length).toBe(1);
  });
  it('a track sound gets its own bank in the score; saves and reopens', () => {
    let s = importFile('o.musicxml', readTestFile('ode-to-joy-piano.musicxml'));
    s = setTrackSound(s, s.tracks[0].id, { file: 'C:\\sf\\a.sf2', bank: 0, program: 5, name: 'A: Piano 2' });
    expect(librarySoundFiles(s)).toEqual(['C:\\sf\\a.sf2']);
    expect(trackBank(s, s.tracks[0])).toBe(256);
    const score = toAlphaTabScore(s, new alphaTab.Settings());
    expect(score.tracks[0].playbackInfo.bank).toBe(256);
    expect(score.tracks[0].playbackInfo.program).toBe(5);
    expect(parseProject(serializeProject(s)).tracks[0].sound).toEqual(s.tracks[0].sound);
    expect(setTrackSound(s, s.tracks[0].id, null).tracks[0].sound).toBeUndefined();
  });
});
