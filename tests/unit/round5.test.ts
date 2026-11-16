// Round 5: mixer maths, loudness, limiter, automation, audio clips, media paths, undo merging,
// and file export round trips (MIDI, MusicXML, Guitar Pro re-imported with the app's importers).
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { exportGuitarPro, exportMidi, exportMusicXml } from '../../src/export';
import { importFile } from '../../src/import';
import {
  absolutizeMedia, addAudioTrack, addClip, clipGainAt, clipStartMs, countNoteOnsets, dbToFader, dbToGain, defaultBand, faderDb,
  faderGain, generateBand, History, integratedLoudness, laneValueAt, lanePoints, limitPeaks, mediaDirFor, msToPos, newEffect,
  normalizeLoudness, panGains, parseProject, peakOf, posToMs, relativizeMedia, serializeProject, splitClipAtMs, trackGain,
  trimClipEnd, trimClipStart, FX_DEFS, FX_PRESETS, FX_TYPES, delaySeconds, presetEffects, type AudioClip, type Song,
} from '../../src/model';
import { readTestFile } from './helpers';

const ode = () => importFile('ode-to-joy-piano.musicxml', readTestFile('ode-to-joy-piano.musicxml'));

describe('gain and pan maths', () => {
  it('fader law: 0.8 = 0 dB, 1 = +5.8 dB, 0 = silence, inverse round-trips', () => {
    expect(faderDb(0.8)).toBeCloseTo(0, 9);
    expect(faderGain(0.8)).toBeCloseTo(1, 9);
    expect(faderDb(1)).toBeCloseTo(5.815, 2);
    expect(faderGain(0)).toBe(0);
    expect(faderDb(0.4)).toBeCloseTo(-18.06, 1);
    for (const db of [-40, -12, -3, 0, 3, 5]) expect(faderDb(dbToFader(db))).toBeCloseTo(db, 9);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
  it('equal-power pan: centre -3 dB per side, hard left/right, constant power', () => {
    const c = panGains(0);
    expect(c.left).toBeCloseTo(Math.SQRT1_2, 9);
    expect(c.right).toBeCloseTo(Math.SQRT1_2, 9);
    expect(panGains(-1)).toEqual({ left: 1, right: expect.closeTo(0, 9) });
    expect(panGains(1).right).toBeCloseTo(1, 9);
    for (const p of [-0.7, -0.2, 0.3, 0.9]) {
      const g = panGains(p);
      expect(g.left ** 2 + g.right ** 2).toBeCloseTo(1, 9);
    }
  });
  it('mute and solo: a soloed track silences the others, mute wins', () => {
    const s = ode();
    s.tracks[0].mixer.volume = 0.8;
    s.tracks.push({ ...structuredClone(s.tracks[0]), id: 'b' });
    expect(trackGain(s, 0)).toBeCloseTo(1, 9);
    s.tracks[1].mixer.solo = true;
    expect(trackGain(s, 0)).toBe(0);
    expect(trackGain(s, 1)).toBeCloseTo(1, 9);
    s.tracks[1].mixer.mute = true;
    expect(trackGain(s, 1)).toBe(0);
  });
});

describe('effects catalogue and presets', () => {
  it('every effect has defaults inside its ranges; presets use known params', () => {
    for (const t of FX_TYPES) {
      const e = newEffect(t);
      for (const p of FX_DEFS[t].params) {
        expect(e.params[p.key]).toBeGreaterThanOrEqual(p.min);
        expect(e.params[p.key]).toBeLessThanOrEqual(p.max);
      }
    }
    for (const p of FX_PRESETS) {
      for (const f of presetEffects(p)) for (const k of Object.keys(f.params)) expect(FX_DEFS[f.type].params.some((d) => d.key === k)).toBe(true);
    }
    const names = FX_PRESETS.map((p) => p.name);
    for (const n of ['Clean guitar', 'Crunch', 'Lead', 'Bass DI', 'Bass drive', 'Drum room', 'Vocal plate']) expect(names).toContain(n);
  });
  it('tempo-synced delay: 1/8 at 120 bpm = 250 ms, dotted 1/8 = 375 ms', () => {
    expect(delaySeconds(1, 120)).toBeCloseTo(0.25, 9);
    expect(delaySeconds(2, 120)).toBeCloseTo(0.375, 9);
    expect(delaySeconds(0, 90)).toBeCloseTo(0.6667, 3);
  });
});

function sine(freq: number, amp: number, secs: number, sr = 48000): Float32Array {
  const n = Math.round(secs * sr);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) out[2 * i] = out[2 * i + 1] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe('loudness (BS.1770) and limiter', () => {
  it('a stereo 1 kHz sine at -20 dBFS measures -20 LUFS (EBU calibration)', () => {
    expect(integratedLoudness(sine(1000, 0.1, 5), 48000)).toBeCloseTo(-20, 1);
    expect(integratedLoudness(sine(1000, 0.1, 5, 44100), 44100)).toBeCloseTo(-20, 1);
  });
  it('silence is -Infinity; gating ignores a silent half', () => {
    expect(integratedLoudness(new Float32Array(48000 * 4), 48000)).toBe(-Infinity);
    const half = sine(1000, 0.1, 6);
    half.fill(0, half.length / 2);
    expect(integratedLoudness(half, 48000)).toBeCloseTo(-20, 0);
  });
  it('limiter keeps every sample under the ceiling and leaves quiet parts alone', () => {
    const s = sine(200, 0.3, 2);
    for (let i = 48000; i < 48000 + 4800; i++) s[2 * i] = s[2 * i + 1] = 1.6 * Math.sin(i / 10);
    limitPeaks(s, 48000, -1);
    expect(peakOf(s)).toBeLessThanOrEqual(dbToGain(-1) + 1e-6);
    expect(Math.abs(s[2 * 1000])).toBeCloseTo(Math.abs(0.3 * Math.sin((2 * Math.PI * 200 * 1000) / 48000)), 4);
  });
  it('normalise to -14 LUFS with a -1 dB peak ceiling (within 0.5 LU)', () => {
    const s = sine(440, 0.05, 6);
    const r = normalizeLoudness(s, 48000, -14, -1);
    expect(r.before).toBeLessThan(-25);
    expect(Math.abs(integratedLoudness(s, 48000) + 14)).toBeLessThan(0.5);
    expect(peakOf(s)).toBeLessThanOrEqual(dbToGain(-1) + 1e-6);
  });
});

describe('automation', () => {
  it('linear between points, held outside, positioned by bar', () => {
    const s = ode();
    const lane = { param: 'volume', points: [{ bar: 2, tick: 0, value: 0.8 }, { bar: 4, tick: 0, value: 0 }] };
    const pts = lanePoints(s, lane);
    expect(pts.map((p) => p.t)).toEqual([2 * 3840, 4 * 3840]);
    expect(laneValueAt(pts, 0)).toBe(0.8);
    expect(laneValueAt(pts, 3 * 3840)).toBeCloseTo(0.4, 9);
    expect(laneValueAt(pts, 10 * 3840)).toBe(0);
    expect(laneValueAt([], 5)).toBeUndefined();
  });
  it('fader drags merge into one undo step; other edits do not', () => {
    const h = new History(0);
    h.apply(1, 'Volume', 'vol:a', 1000);
    h.apply(2, 'Volume', 'vol:a', 1200);
    h.apply(3, 'Volume', 'vol:a', 1400);
    h.apply(4, 'Pan', 'pan:a', 1500);
    h.apply(5, 'Other', undefined, 1600);
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(0);
    h.redo();
    h.apply(9, 'Volume', 'vol:a', 1700); // after an undo/redo: a new step
    expect(h.undo()).toBe(3);
  });
});

describe('audio clips', () => {
  const song = (): Song => {
    const s = ode();
    return addAudioTrack(s).song;
  };
  const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
    id: 'c1', name: 'take', file: 'C:\\x\\a.wav', bar: 2, tick: 0, startMs: 0, lengthMs: 4000, sourceMs: 6000, fadeInMs: 100, fadeOutMs: 200, gainDb: 0, ...over,
  });
  it('an audio track has a rest staff the length of the song and is hidden in the score', () => {
    const s = song();
    const t = s.tracks[s.tracks.length - 1];
    expect(t.audio).toEqual({ clips: [] });
    expect(t.staves[0].measures.length).toBe(s.bars.length);
    expect(t.display.visible).toBe(false);
    expect(countNoteOnsets(s)).toBe(countNoteOnsets(ode()));
  });
  it('a clip stays on its bar when the tempo changes', () => {
    const s = addClip(song(), 'audio1', clip());
    const at120 = clipStartMs(s, clip());
    const faster = { ...s, tempos: [{ bar: 0, tick: 0, bpm: s.tempos[0].bpm * 2 }] };
    expect(clipStartMs(faster, clip())).toBeCloseTo(at120 / 2, 6);
    expect(msToPos(s, posToMs(s, 5, 960))).toEqual({ bar: 5, tick: 960 });
  });
  it('split, trim and fades', () => {
    let s = addClip(song(), 'audio1', clip());
    const start = clipStartMs(s, clip());
    s = splitClipAtMs(s, 'audio1', 'c1', start + 1500);
    const [a, b] = s.tracks.find((t) => t.id === 'audio1')!.audio!.clips;
    expect(a.lengthMs).toBeCloseTo(1500, 6);
    expect(b.startMs).toBeCloseTo(1500, 6);
    expect(b.lengthMs).toBeCloseTo(2500, 6);
    expect(clipStartMs(s, b)).toBeCloseTo(start + 1500, 3);
    const t1 = trimClipStart(s, clip(), start + 500);
    expect(t1.startMs).toBeCloseTo(500, 3);
    expect(t1.lengthMs).toBeCloseTo(3500, 3);
    expect(trimClipEnd(s, clip(), start + 99999).lengthMs).toBe(6000); // cannot go past the source
    expect(clipGainAt(clip(), 0)).toBe(0);
    expect(clipGainAt(clip(), 50)).toBeCloseTo(0.5, 9);
    expect(clipGainAt(clip(), 2000)).toBe(1);
    expect(clipGainAt(clip(), 3900)).toBeCloseTo(0.5, 9);
  });
  it('media paths: relative inside <name>_media when saved, absolute again when opened', () => {
    const dir = mediaDirFor('D:\\Songs\\My song.mgproj');
    expect(dir).toBe('D:\\Songs\\My song_media');
    const s = addClip(addClip(song(), 'audio1', clip({ file: dir + '\\take1.wav' })), 'audio1', clip({ id: 'c2', file: 'E:\\elsewhere\\b.wav' }));
    const rel = relativizeMedia(s, dir);
    const files = rel.tracks.find((t) => t.id === 'audio1')!.audio!.clips.map((c) => c.file);
    expect(files).toEqual(['take1.wav', 'E:\\elsewhere\\b.wav']);
    const back = absolutizeMedia(parseProject(serializeProject(rel)), dir);
    expect(back).toEqual(s);
  });
});

describe('export round trips (re-imported with the app importers)', () => {
  const cases: [string, () => Song][] = [
    ['Ode to Joy (piano, 2 staves)', ode],
    ['Ode to Joy + Rock band', () => generateBand(ode(), defaultBand('rock', ode().tracks[0].id, 3))],
    ['full-song.gp (many tracks, drums, techniques)', () => importFile('full-song.gp', readTestFile('full-song.gp'))],
  ];
  for (const [name, make] of cases) {
    it(name, () => {
      const s = make();
      const notes = countNoteOnsets(s);
      const mid = importFile('x.mid', exportMidi(s));
      const xml = importFile('x.musicxml', new TextEncoder().encode(exportMusicXml(s)));
      const gp = importFile('x.gp', exportGuitarPro(s));
      console.log(`${name}: model ${notes} notes; MIDI ${countNoteOnsets(mid)}, MusicXML ${countNoteOnsets(xml)}, GP ${countNoteOnsets(gp)}`);
      expect(countNoteOnsets(xml)).toBe(notes);
      expect(countNoteOnsets(gp)).toBe(notes);
      expect(xml.bars.length).toBe(s.bars.length);
      expect(gp.tracks.length).toBe(s.tracks.length);
      // The MIDI file holds every note; the MIDI importer quantises to 16ths, which can merge a few
      // 32nd/triplet notes of the same pitch, so re-import is exact only for 16th-grid songs.
      const raw = new Midi(exportMidi(s)).tracks.reduce((a, t) => a + t.notes.length, 0);
      expect(raw).toBe(notes);
      if (!name.startsWith('full-song')) expect(countNoteOnsets(mid)).toBe(notes);
      else expect(countNoteOnsets(mid)).toBeGreaterThan(notes * 0.99);
    });
  }
});
